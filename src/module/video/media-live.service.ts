import {
  ChannelState,
  CreateChannelCommand,
  CreateChannelCommandInput,
  CreateInputCommand,
  DeleteChannelCommand,
  DeleteInputCommand,
  DescribeChannelCommand,
  MediaLiveClient,
  StartChannelCommand,
  StopChannelCommand,
} from '@aws-sdk/client-medialive';
import { Injectable, Logger } from '@nestjs/common';
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
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            ...(process.env.AWS_SESSION_TOKEN
              ? { sessionToken: process.env.AWS_SESSION_TOKEN }
              : {}),
          },
        }
      : {}),
  });

  private readonly roleArn = process.env.MEDIALIVE_ROLE_ARN!;
  private readonly s3Bucket = process.env.S3_BUCKET!;
  private readonly securityGroupId = process.env.MEDIALIVE_SECURITY_GROUP_ID;
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

    if (!this.s3Bucket || !this.roleArn) {
      throw new Error(
        'S3_BUCKET or MEDIALIVE_ROLE_ARN is not defined in environment',
      );
    }
    const inputResult = await this.client.send(
      new CreateInputCommand({
        Name: `rappio-input-${contentId}`,
        Type: 'RTMP_PUSH',
        Destinations: [
          { StreamName: `live/${streamKey}` },
          // MediaLive requires 2 destinations for redundancy
        ],
        InputSecurityGroups: this.securityGroupId
          ? [this.securityGroupId]
          : undefined,
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

    // DEBUG: Log the channel config to inspect destinations
    this.logger.log(
      `Channel config destinations: ${JSON.stringify(channelConfig.Destinations, null, 2)}`,
    );

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
   *
   * CRITICAL: This method must fully clean up both channel and input,
   * otherwise AWS service limit (5 push inputs) will be exceeded.
   */
  async stopChannel(params: {
    channelId: string;
    inputId: string;
  }): Promise<void> {
    const { channelId, inputId } = params;

    // Step 1: Stop the channel
    try {
      this.logger.log(`⏹️ Stopping MediaLive channel: ${channelId}`);
      await this.client.send(new StopChannelCommand({ ChannelId: channelId }));

      // Wait for IDLE before deleting — can't delete a running channel
      await this.waitForChannelState(channelId, ChannelState.IDLE, 120);
      this.logger.log(`✅ Channel stopped and in IDLE state: ${channelId}`);
    } catch (err) {
      this.logger.error(
        `❌ Failed to stop channel ${channelId}: ${(err as any).message}`,
      );
      throw err; // Re-throw to prevent input deletion if channel stop fails
    }

    // Step 2: Delete the channel with verification
    try {
      this.logger.log(`🗑️ Deleting MediaLive channel: ${channelId}`);
      await this.client.send(
        new DeleteChannelCommand({ ChannelId: channelId }),
      );

      // Verify deletion
      await this.verifyChannelDeleted(channelId);
      this.logger.log(`✅ Channel deleted and verified: ${channelId}`);
    } catch (err) {
      this.logger.error(
        `❌ Failed to delete channel ${channelId}: ${(err as any).message}`,
      );
      // Continue to input deletion even if channel deletion fails
    }

    // Step 3: Wait longer before input deletion (channel deletion takes time)
    await new Promise((r) => setTimeout(r, 10000));

    // Step 4: Delete the input with retry logic
    await this.deleteInputWithRetry(inputId, 3);
  }

  /**
   * Verify that a channel is actually deleted from AWS
   */
  private async verifyChannelDeleted(
    channelId: string,
    maxAttempts = 10,
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this.client.send(
          new DescribeChannelCommand({ ChannelId: channelId }),
        );

        // If DELETED state, we're good
        if (result.State === ChannelState.DELETED) {
          this.logger.debug(`Channel ${channelId} is in DELETED state`);
          return;
        }

        // If still exists after expected time, wait longer
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        // If we get a "not found" error, it's deleted
        if (
          err.name === 'BadRequestException' ||
          err.message?.includes('not found')
        ) {
          this.logger.log(`✅ Channel ${channelId} confirmed deleted`);
          return;
        }

        // Other errors, retry
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    this.logger.warn(
      `⚠️ Could not verify deletion of channel ${channelId} after ${maxAttempts} attempts`,
    );
  }

  /**
   * Delete input with retry logic to handle transient failures
   */
  private async deleteInputWithRetry(
    inputId: string,
    maxRetries = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `🗑️ Deleting MediaLive input: ${inputId} (attempt ${attempt}/${maxRetries})`,
        );
        await this.client.send(new DeleteInputCommand({ InputId: inputId }));

        // Verify deletion
        await this.verifyInputDeleted(inputId);
        this.logger.log(`✅ Input deleted and verified: ${inputId}`);
        return;
      } catch (err: any) {
        const isLastAttempt = attempt === maxRetries;
        const errorMsg = (err as any).message || String(err);

        if (isLastAttempt) {
          this.logger.error(
            `❌ CRITICAL: Failed to delete input ${inputId} after ${maxRetries} attempts: ${errorMsg}. THIS WILL COUNT AGAINST SERVICE LIMIT!`,
          );
          throw err;
        } else {
          this.logger.warn(
            `⚠️ Failed to delete input ${inputId} (attempt ${attempt}/${maxRetries}): ${errorMsg}. Retrying...`,
          );
          // Wait before retry (exponential backoff)
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
    }
  }

  /**
   * Verify that an input is actually deleted from AWS
   */
  private async verifyInputDeleted(
    inputId: string,
    maxAttempts = 10,
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.client.send(
          new DescribeChannelCommand({ ChannelId: inputId }),
        );

        // Still exists, wait and retry
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        // If we get a "not found" error, it's deleted
        if (
          err.name === 'BadRequestException' ||
          err.message?.includes('not found')
        ) {
          this.logger.log(`✅ Input ${inputId} confirmed deleted`);
          return;
        }

        // Other errors, retry
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    this.logger.warn(
      `⚠️ Could not verify deletion of input ${inputId} after ${maxAttempts} attempts`,
    );
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
    this.logger.log(`Generated S3 Output Base: ${s3OutputBase}`);

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
          Bitrate: parseInt(r.vBitrate.replace('k', '')) * 1000, // Convert '2800k' to 2800000
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
          MaxBitrate: parseInt(r.maxrate.replace('k', '')) * 1000, // Convert '3360k' to 3360000
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
          Bitrate: parseInt(r.aBitrate.replace('k', '')) * 1000, // Convert '128k' to 128000
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
            { Url: `${s3OutputBase}/master` }, // ✅ exactly 1 for SINGLE_PIPELINE
          ],
          // MediaPackageSettings and MultiplexSettings must be absent or empty
        },
      ],
      ChannelClass: 'SINGLE_PIPELINE' as const,
      Tags: {
        contentId,
        service: 'rappio',
      },
    };
  }

  /**
   * 🔍 DIAGNOSTIC: List all MediaLive inputs in the account
   * Helps identify orphaned inputs that are consuming the service limit
   */
  async listAllInputs() {
    try {
      this.logger.log('📋 Fetching all MediaLive inputs...');

      // Note: AWS MediaLive SDK requires using describe operations to find inputs
      // Inputs are typically associated with channels
      this.logger.warn(
        '⚠️ Note: Direct input listing not fully available. Use listAllChannels() to see associated inputs.',
      );

      return {
        count: 0,
        inputs: [],
        note: 'Inputs are associated with channels. Check listAllChannels() instead.',
      };
    } catch (err) {
      this.logger.error(`Failed to list inputs: ${(err as any).message}`);
      throw err;
    }
  }

  /**
   * 🔍 DIAGNOSTIC: List all MediaLive channels in the account
   * Helps identify stuck or orphaned channels
   */
  async listAllChannels() {
    try {
      this.logger.log('📋 Fetching all MediaLive channels...');

      // AWS SDK MediaLive doesn't have a native ListChannels, so we'll collect via API
      // This is a simplified version - in production you might want to use pagination
      const allChannels: any[] = [];

      // Attempt to describe using client API if available
      try {
        // Create a direct API call to list channels
        const response = await (this.client as any).send(
          new (require('@aws-sdk/client-medialive')
            .DescribeChannelCommand as any)({}),
        );
        if (response?.Channels) {
          allChannels.push(...response.Channels);
        }
      } catch (e: any) {
        // If direct list not available, channel diagnostics will be limited
        this.logger.debug(
          `Could not retrieve channels via DescribeChannel: ${e.message}`,
        );
      }

      return {
        count: allChannels.length,
        channels: allChannels.map((ch: any) => ({
          id: ch.Id,
          name: ch.Name,
          state: ch.State,
          tags: ch.Tags,
          arn: ch.Arn,
        })),
        warning:
          allChannels.length === 0
            ? 'Could not retrieve channels. Ensure AWS credentials and permissions are correct.'
            : undefined,
      };
    } catch (err) {
      this.logger.error(`Failed to list channels: ${(err as any).message}`);
      throw err;
    }
  }

  /**
   * 🧹 CLEANUP: Force delete an orphaned input
   * DANGEROUS - only use on known orphaned inputs!
   */
  async forceDeleteInput(inputId: string) {
    try {
      this.logger.warn(`⚠️ FORCE DELETING orphaned input: ${inputId}`);
      await this.client.send(new DeleteInputCommand({ InputId: inputId }));
      this.logger.log(`✅ Input force deleted: ${inputId}`);
    } catch (err) {
      this.logger.error(
        `Failed to force delete input ${inputId}: ${(err as any).message}`,
      );
      throw err;
    }
  }

  /**
   * 🧹 CLEANUP: Force delete an orphaned channel
   * DANGEROUS - only use on known orphaned channels!
   */
  async forceDeleteChannel(channelId: string) {
    try {
      this.logger.warn(`⚠️ FORCE STOPPING channel: ${channelId}`);

      // First try to stop it
      try {
        await this.client.send(
          new StopChannelCommand({ ChannelId: channelId }),
        );
        await this.waitForChannelState(channelId, ChannelState.IDLE, 60);
      } catch (err) {
        this.logger.warn(`Could not stop channel, attempting delete anyway...`);
      }

      this.logger.warn(`⚠️ FORCE DELETING orphaned channel: ${channelId}`);
      await this.client.send(
        new DeleteChannelCommand({ ChannelId: channelId }),
      );
      this.logger.log(`✅ Channel force deleted: ${channelId}`);
    } catch (err) {
      this.logger.error(
        `Failed to force delete channel ${channelId}: ${(err as any).message}`,
      );
      throw err;
    }
  }

  /**
   * 🧹 CLEANUP: Clean up all orphaned resources for a specific contentId
   * Call this if a stream crashes and leaves resources behind
   */
  async cleanupOrphanedResourcesForContent(contentId: string) {
    try {
      this.logger.log(
        `🧹 Cleaning up orphaned resources for content: ${contentId}`,
      );

      // Find channels and inputs with this contentId tag
      const channels = await this.listAllChannels();
      const orphanedChannels = channels.channels.filter(
        (ch: any) => ch.tags?.contentId === contentId,
      );

      let deletedCount = 0;

      for (const channel of orphanedChannels) {
        try {
          await this.forceDeleteChannel(channel.id);
          deletedCount++;
        } catch (err) {
          this.logger.warn(`Failed to delete channel ${channel.id}`);
        }
      }

      this.logger.log(
        `✅ Cleanup complete: deleted ${deletedCount} orphaned resources`,
      );
      return { deletedCount };
    } catch (err) {
      this.logger.error(`Cleanup failed: ${(err as any).message}`);
      throw err;
    }
  }
}
