import { Injectable, Logger } from '@nestjs/common';
import {
  MediaLiveClient,
  CreateChannelCommand,
  CreateChannelCommandInput,
  DeleteChannelCommand,
  StartChannelCommand,
  StopChannelCommand,
  DescribeChannelCommand,
  CreateInputCommand,
  DeleteInputCommand,
  ChannelState,
} from '@aws-sdk/client-medialive';
import { VIDEO_RENDITIONS } from '../../common/video.constants';

export interface StartChannelResult {
  channelId: string;
  inputId: string;
  rtmpUrl: string;
}

@Injectable()
export class MediaLiveService {
  private readonly logger = new Logger(MediaLiveService.name);

  private readonly client = new MediaLiveClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  private readonly roleArn = process.env.MEDIALIVE_ROLE_ARN!;
  private readonly s3Bucket = process.env.S3_BUCKET!;
  private readonly awsRegion = process.env.AWS_REGION || 'us-east-1';

  /**
   * Creates a MediaLive RTMP input + channel for a single stream,
   * then starts the channel. Called from handleStreamStart().
   *
   * Returns channelId + inputId (both stored in DB for cleanup),
   * and the RTMP push URL OBS/NodeMediaServer re-pushes to.
   */
  async startChannel(params: {
    streamKey: string;
    contentId: string;
  }): Promise<StartChannelResult> {
    const { streamKey, contentId } = params;

    this.logger.log(`Creating MediaLive input for stream: ${streamKey}`);

    // Step 1 — Create a RTMP_PUSH input (MediaLive gives us the endpoint)
    const inputResult = await this.client.send(
      new CreateInputCommand({
        Name: `rappio-input-${contentId}`,
        Type: 'RTMP_PUSH',
        Destinations: [
          { StreamName: `live/${streamKey}` },
          { StreamName: `live/${streamKey}` }, // MediaLive requires 2 destinations for redundancy
        ],
        Tags: {
          contentId,
          streamKey,
          service: 'rappio',
        },
      }),
    );

    const input = inputResult.Input!;
    const inputId = input.Id!;

    // The URL NodeMediaServer re-pushes to — e.g. rtmp://xxx.medialive.amazonaws.com/live/streamKey
    const rtmpUrl = input.Destinations?.[0]?.Url ?? '';

    this.logger.log(`MediaLive input created: ${inputId} → ${rtmpUrl}`);

    // Step 2 — Build the channel config from VIDEO_RENDITIONS
    const channelConfig = this.buildChannelConfig({ contentId, inputId });

    // Step 3 — Create the channel
    const channelResult = await this.client.send(
      new CreateChannelCommand(channelConfig),
    );

    const channelId = channelResult.Channel?.Id!;
    this.logger.log(`MediaLive channel created: ${channelId}`);

    // Step 4 — Wait for channel to reach IDLE before starting
    // (newly created channels need ~10s to become ready)
    await this.waitForChannelState(channelId, ChannelState.IDLE, 120);

    // Step 5 — Start the channel
    await this.client.send(new StartChannelCommand({ ChannelId: channelId }));
    this.logger.log(`MediaLive channel started: ${channelId}`);

    return { channelId, inputId, rtmpUrl };
  }

  /**
   * Stops and deletes the MediaLive channel + input for a stream.
   * Called from handleStreamStop() / cleanupSession().
   */
  async stopChannel(params: {
    channelId: string;
    inputId: string;
  }): Promise<void> {
    const { channelId, inputId } = params;

    try {
      this.logger.log(`Stopping MediaLive channel: ${channelId}`);
      await this.client.send(new StopChannelCommand({ ChannelId: channelId }));

      // Wait for IDLE before deleting — can't delete a running channel
      await this.waitForChannelState(channelId, ChannelState.IDLE, 120);

      this.logger.log(`Deleting MediaLive channel: ${channelId}`);
      await this.client.send(
        new DeleteChannelCommand({ ChannelId: channelId }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to stop/delete channel ${channelId}: ${(err as any).message}`,
      );
    }

    try {
      // Small delay — input can't be deleted while channel is still deleting
      await new Promise((r) => setTimeout(r, 5000));
      this.logger.log(`Deleting MediaLive input: ${inputId}`);
      await this.client.send(new DeleteInputCommand({ InputId: inputId }));
    } catch (err) {
      this.logger.error(
        `Failed to delete input ${inputId}: ${(err as any).message}`,
      );
    }
  }

  /**
   * Poll until a channel reaches the desired state or timeout expires.
   */
  private async waitForChannelState(
    channelId: string,
    targetState: ChannelState,
    timeoutSeconds: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      const result = await this.client.send(
        new DescribeChannelCommand({ ChannelId: channelId }),
      );

      const state = result.State;
      this.logger.debug(`Channel ${channelId} state: ${state}`);

      if (state === targetState) return;

      if (
        state === ChannelState.CREATE_FAILED ||
        state === ChannelState.DELETED
      ) {
        throw new Error(
          `Channel ${channelId} entered terminal state: ${state}`,
        );
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error(
      `Channel ${channelId} did not reach ${targetState} within ${timeoutSeconds}s`,
    );
  }

  /**
   * Builds the full CreateChannelCommandInput from VIDEO_RENDITIONS.
   * Mirrors the FFmpeg multi-bitrate HLS args that were in startFFmpegTranscoding().
   */
  private buildChannelConfig(params: {
    contentId: string;
    inputId: string;
  }): CreateChannelCommandInput {
    const { contentId, inputId } = params;

    const s3OutputBase = `s3://${this.s3Bucket}/live/${contentId}`;

    // One HLS group output per rendition
    const outputs = VIDEO_RENDITIONS.map((r) => ({
      OutputName: r.name,
      VideoDescriptionName: `video_${r.name}`,
      AudioDescriptionNames: [`audio_${r.name}`],
      OutputSettings: {
        HlsOutputSettings: {
          HlsSettings: {
            StandardHlsSettings: {
              M3u8Settings: {
                AudioFramesPerPes: 4,
                AudioPids: '492-498',
                NielsenId3Behavior: 'NO_PASSTHROUGH' as const,
                PcrControl: 'PCR_EVERY_PES_PACKET' as const,
                PmtPid: '480',
                ProgramNum: 1,
                Scte35Pid: '500',
                TimedMetadataPid: '502',
                VideoPid: '481',
              },
            },
          },
          NameModifier: `_${r.name}`,
          SegmentModifier: '',
        },
      },
    }));

    const videoDescriptions = VIDEO_RENDITIONS.map((r) => ({
      Name: `video_${r.name}`,
      Width: r.width,
      Height: r.height,
      RespondToAfd: 'NONE' as const,
      ScalingBehavior: 'DEFAULT' as const,
      Sharpness: 50,
      CodecSettings: {
        H264Settings: {
          AfdSignaling: 'NONE' as const,
          Bitrate: parseInt(r.vBitrate),
          ColorMetadata: 'INSERT' as const,
          EntropyEncoding: 'CABAC' as const,
          FlickerAq: 'ENABLED' as const,
          FramerateControl: 'SPECIFIED' as const,
          FramerateDenominator: 1,
          FramerateNumerator: 30,
          GopBReference: 'DISABLED' as const,
          GopClosedCadence: 1,
          GopNumBFrames: 2,
          GopSize: 2,
          GopSizeUnits: 'SECONDS' as const,
          Level: 'H264_LEVEL_AUTO' as const,
          LookAheadRateControl: 'HIGH' as const,
          MaxBitrate: parseInt(r.maxrate),
          MinIInterval: 0,
          NumRefFrames: 1,
          ParControl: 'INITIALIZE_FROM_SOURCE' as const,
          Profile: 'MAIN' as const,
          RateControlMode: 'CBR' as const,
          ScanType: 'PROGRESSIVE' as const,
          SceneChangeDetect: 'ENABLED' as const,
          SpatialAq: 'ENABLED' as const,
          Syntax: 'DEFAULT' as const,
          TemporalAq: 'ENABLED' as const,
          TimecodeInsertion: 'DISABLED' as const,
        },
      },
    }));

    const audioDescriptions = VIDEO_RENDITIONS.map((r) => ({
      Name: `audio_${r.name}`,
      AudioSelectorName: 'default',
      AudioTypeControl: 'FOLLOW_INPUT' as const,
      CodecSettings: {
        AacSettings: {
          Bitrate: parseInt(r.aBitrate),
          CodingMode: 'CODING_MODE_2_0' as const,
          InputType: 'NORMAL' as const,
          Profile: 'LC' as const,
          RateControlMode: 'CBR' as const,
          RawFormat: 'NONE' as const,
          SampleRate: 44100,
          Spec: 'MPEG4' as const,
        },
      },
      LanguageCodeControl: 'FOLLOW_INPUT' as const,
    }));

    return {
      Name: `rappio-channel-${contentId}`,
      RoleArn: this.roleArn,
      InputAttachments: [
        {
          InputId: inputId,
          InputAttachmentName: 'rtmp-input',
          InputSettings: {
            DeblockFilter: 'DISABLED' as const,
            DenoiseFilter: 'DISABLED' as const,
            FilterStrength: 1,
            InputFilter: 'AUTO' as const,
            SourceEndBehavior: 'CONTINUE' as const,
          },
        },
      ],
      EncoderSettings: {
        VideoDescriptions: videoDescriptions,
        AudioDescriptions: audioDescriptions,
        OutputGroups: [
          {
            Name: 'hls-group',
            OutputGroupSettings: {
              HlsGroupSettings: {
                AdMarkers: [],
                CaptionLanguageSetting: 'OMIT' as const,
                CaptionLanguageMappings: [],
                ClientCache: 'ENABLED' as const,
                CodecSpecification: 'RFC_4281' as const,
                Destination: {
                  DestinationRefId: 's3-destination',
                },
                DirectoryStructure: 'SUBDIRECTORY_PER_STREAM' as const,
                HlsCdnSettings: {
                  HlsS3Settings: {
                    CannedAcl: 'BUCKET_OWNER_FULL_CONTROL' as const,
                  },
                },
                HlsId3SegmentTagging: 'DISABLED' as const,
                IFrameOnlyPlaylists: 'DISABLED' as const,
                IndexNSegments: 10,
                InputLossAction: 'EMIT_OUTPUT' as const,
                IvInManifest: 'INCLUDE' as const,
                IvSource: 'FOLLOWS_SEGMENT_NUMBER' as const,
                KeepSegments: 21,
                ManifestCompression: 'NONE' as const,
                ManifestDurationFormat: 'FLOATING_POINT' as const,
                MinSegmentLength: 0,
                Mode: 'LIVE' as const,
                OutputSelection: 'MANIFESTS_AND_SEGMENTS' as const,
                ProgramDateTime: 'INCLUDE' as const,
                ProgramDateTimePeriod: 600,
                RedundantManifest: 'DISABLED' as const,
                SegmentLength: 2,
                SegmentationMode: 'USE_SEGMENT_DURATION' as const,
                SegmentsPerSubdirectory: 10000,
                StreamInfResolution: 'INCLUDE' as const,
                TimedMetadataId3Frame: 'PRIV' as const,
                TimedMetadataId3Period: 10,
                TsFileMode: 'SEGMENTED_FILES' as const,
              },
            },
            Outputs: outputs,
          },
        ],
        TimecodeConfig: {
          Source: 'EMBEDDED' as const,
        },
      },
      Destinations: [
        {
          Id: 's3-destination',
          Settings: [
            { Url: `${s3OutputBase}/` },
            { Url: `${s3OutputBase}/` }, // Duplicate required for single-pipeline channels
          ],
        },
      ],
      ChannelClass: 'SINGLE_PIPELINE' as const,
      Tags: {
        contentId,
        service: 'rappio',
      },
    };
  }
}
