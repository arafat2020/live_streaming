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
import { ListChannelsCommand } from '@aws-sdk/client-medialive';

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

  // ==========================================
  // 1. CORE STREAMING OPERATIONS
  // ==========================================

  /**
   * Orchestrates the creation and startup of a MediaLive Channel and Input.
   */
  async startChannel(params: {
    streamKey: string;
    contentId: string;
    onChannelCreated?: (channelId: string, inputId: string) => Promise<void>;
  }): Promise<StartChannelResult> {
    const { streamKey, contentId, onChannelCreated } = params;

    // Step 1: Create RTMP Input
    const inputResult = await this.client.send(
      new CreateInputCommand({
        Name: `rappio-input-${contentId}`,
        Type: 'RTMP_PUSH',
        Destinations: [{ StreamName: `live/${streamKey}` }],
        InputSecurityGroups: this.securityGroupId ? [this.securityGroupId] : undefined,
        Tags: { contentId, streamKey, service: 'rappio' },
      }),
    );

    const inputId = inputResult.Input!.Id!;
    const rtmpUrl = inputResult.Input!.Destinations?.[0]?.Url ?? '';
    this.logger.log(`✅ MediaLive Input Created: ${inputId}`);

    // Step 2: Create Channel
    const channelConfig = this.buildChannelConfig({ contentId, inputId });
    const channelResult = await this.client.send(new CreateChannelCommand(channelConfig));
    const channelId = channelResult.Channel?.Id!;
    this.logger.log(`✅ MediaLive Channel Created: ${channelId}`);

    // SAVE TO DB IMMEDIATELY to prevent race conditions with webhooks
    if (onChannelCreated) {
      await onChannelCreated(channelId, inputId);
    }

    // Step 3: Wait for Channel to reach IDLE state (ready to start)
    await this.waitForChannelState(channelId, ChannelState.IDLE, 120);

    // Step 4: Start the Channel
    await this.client.send(new StartChannelCommand({ ChannelId: channelId }));
    this.logger.log(`🚀 MediaLive Channel Starting: ${channelId}`);

    return { channelId, inputId, rtmpUrl };
  }

  /**
   * Stops and deletes a MediaLive Channel and its associated Input.
   */
  async stopChannel(params: { channelId: string; inputId: string }): Promise<void> {
    const { channelId, inputId } = params;

    // 1. Stop the channel
    try {
      this.logger.log(`⏹️ Stopping MediaLive channel: ${channelId}`);
      await this.client.send(new StopChannelCommand({ ChannelId: channelId }));
      await this.waitForChannelState(channelId, ChannelState.IDLE, 120);
    } catch (err) {
      this.logger.error(`❌ Failed to stop channel ${channelId}: ${err.message}`);
      throw err;
    }

    // 2. Delete the channel
    try {
      await this.client.send(new DeleteChannelCommand({ ChannelId: channelId }));
      await this.verifyChannelDeleted(channelId);
      this.logger.log(`🗑️ Channel deleted: ${channelId}`);
    } catch (err) {
      this.logger.error(`❌ Failed to delete channel ${channelId}: ${err.message}`);
    }

    // 3. Delete the input (with retry logic as AWS takes time to release it)
    await new Promise((r) => setTimeout(r, 10000));
    await this.deleteInputWithRetry(inputId, 3);
  }

  // ==========================================
  // 2. STATE WAITERS & VERIFIERS
  // ==========================================

  private async waitForChannelState(id: string, target: ChannelState, timeout: number) {
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      const { State } = await this.client.send(new DescribeChannelCommand({ ChannelId: id }));
      if (State === target) return;
      if (State === 'CREATE_FAILED' || State === 'DELETED') throw new Error(`Terminal state: ${State}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`Timeout waiting for ${target}`);
  }

  private async verifyChannelDeleted(id: string) {
    for (let i = 0; i < 10; i++) {
      try {
        const { State } = await this.client.send(new DescribeChannelCommand({ ChannelId: id }));
        if (State === 'DELETED') return;
      } catch (err: any) {
        if (err.name === 'NotFoundException' || err.message?.includes('not found')) return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private async deleteInputWithRetry(id: string, retries: number) {
    for (let i = 1; i <= retries; i++) {
      try {
        await this.client.send(new DeleteInputCommand({ InputId: id }));
        return;
      } catch (err: any) {
        if (i === retries) throw err;
        await new Promise((r) => setTimeout(r, 5000 * i));
      }
    }
  }

  // ==========================================
  // 3. CHANNEL CONFIGURATION BUILDER
  // ==========================================

  private buildChannelConfig(params: { contentId: string; inputId: string }): CreateChannelCommandInput {
    const { contentId, inputId } = params;
    const s3OutputBase = `s3://${this.s3Bucket}/live/${contentId}`;

    const videoDescriptions = VIDEO_RENDITIONS.map((r) => ({
      Name: `video_${r.name}`,
      Width: r.width,
      Height: r.height,
      CodecSettings: {
        H264Settings: {
          Bitrate: parseInt(r.vBitrate) * 1000,
          MaxBitrate: parseInt(r.maxrate) * 1000,
          GopSize: 2,
          GopSizeUnits: 'SECONDS' as const,
          RateControlMode: 'CBR' as const,
          Profile: 'MAIN' as const,
          SceneChangeDetect: 'ENABLED' as const,
        },
      },
    }));

    const audioDescriptions = VIDEO_RENDITIONS.map((r) => ({
      Name: `audio_${r.name}`,
      AudioSelectorName: 'default',
      CodecSettings: {
        AacSettings: {
          Bitrate: parseInt(r.aBitrate) * 1000,
          CodingMode: 'CODING_MODE_2_0' as const,
          SampleRate: 44100,
        },
      },
    }));

    const outputs = VIDEO_RENDITIONS.map((r) => ({
      OutputName: r.name,
      VideoDescriptionName: `video_${r.name}`,
      AudioDescriptionNames: [`audio_${r.name}`],
      OutputSettings: {
        HlsOutputSettings: {
          HlsSettings: { StandardHlsSettings: { M3u8Settings: { AudioFramesPerPes: 4, ProgramNum: 1 } } },
          NameModifier: `_${r.name}`,
        },
      },
    }));

    return {
      Name: `rappio-channel-${contentId}`,
      RoleArn: this.roleArn,
      InputAttachments: [{ InputId: inputId, InputAttachmentName: 'rtmp-input' }],
      EncoderSettings: {
        TimecodeConfig: { Source: 'SYSTEMCLOCK' },
        VideoDescriptions: videoDescriptions,
        AudioDescriptions: audioDescriptions,
        OutputGroups: [{
          Name: 'hls-group',
          OutputGroupSettings: {
            HlsGroupSettings: {
              Destination: { DestinationRefId: 's3-destination' },
              DirectoryStructure: 'SUBDIRECTORY_PER_STREAM' as const,
              IndexNSegments: 10,
              SegmentLength: 2,
              Mode: 'LIVE' as const,
            },
          },
          Outputs: outputs,
        }],
      },
      Destinations: [{
        Id: 's3-destination',
        Settings: [{ Url: `${s3OutputBase}/master` }],
      }],
      ChannelClass: 'SINGLE_PIPELINE' as const,
    };
  }

  // ==========================================
  // 4. DIAGNOSTICS & CLEANUP
  // ==========================================

  async listAllChannels() {
    try {
      const response = await this.client.send(new ListChannelsCommand({}));
      const channels = response.Channels || [];
      return { channels, count: channels.length };
    } catch (err) {
      this.logger.error(`Failed to list channels: ${err.message}`);
      return { channels: [], count: 0 };
    }
  }

  async cleanupOrphanedResourcesForContent(contentId: string) {
    this.logger.log(`Cleaning up orphaned resources for content ${contentId}`);
    // Dummy implementation for compilation
    return { deletedCount: 0 };
  }

  async forceDeleteInput(inputId: string) {
    try {
      await this.client.send(new DeleteInputCommand({ InputId: inputId }));
    } catch (err) {
      this.logger.error(`Force delete input failed for ${inputId}: ${err.message}`);
    }
  }

  async forceDeleteChannel(channelId: string) {
    try {
      await this.client.send(new StopChannelCommand({ ChannelId: channelId }));
      await this.waitForChannelState(channelId, ChannelState.IDLE, 60);
      await this.client.send(new DeleteChannelCommand({ ChannelId: channelId }));
    } catch (err) {
      this.logger.error(`Force delete failed for ${channelId}`);
    }
  }
}
