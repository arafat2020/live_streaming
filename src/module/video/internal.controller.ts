import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { VideoService } from './video.service';

/**
 * Shape of the EventBridge MediaLive Channel State Change event.
 * EventBridge wraps the MediaLive event in a standard envelope.
 */
interface MediaLiveChannelEvent {
  source: string;
  'detail-type': string;
  detail: {
    state:
      | 'RUNNING'
      | 'IDLE'
      | 'STARTING'
      | 'STOPPING'
      | 'CREATING'
      | 'CREATE_FAILED';
    channel_arn: string;
    channel_id?: string;
    message?: string;
    pipelines_running_count?: number;
  };
}

@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(private readonly videoService: VideoService) {}

  /**
   * EventBridge → this endpoint when MediaLive channel state changes.
   * Handles both RUNNING (stream is live) and IDLE (stream ended/failed).
   *
   * Protected by a shared secret set in Terraform (var.webhook_secret)
   * and passed as X-Webhook-Secret header by EventBridge.
   */
  @Post('stream/medialive-event')
  @HttpCode(200)
  async handleMediaLiveEvent(
    @Body() event: MediaLiveChannelEvent,
    @Headers('x-webhook-secret') secret: string,
  ) {
    // Verify the shared secret — reject anything without it
    if (secret !== process.env.WEBHOOK_SECRET) {
      this.logger.warn('Rejected webhook call — invalid secret');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const { state, channel_arn } = event.detail;

    // Extract channel ID from ARN: arn:aws:medialive:region:account:channel:CHANNEL_ID
    const channelId = channel_arn?.split(':').pop();

    if (!channelId) {
      this.logger.warn(`Could not extract channelId from ARN: ${channel_arn}`);
      return { ok: true };
    }

    this.logger.log(`MediaLive event: channel=${channelId} state=${state}`);

    if (state === 'RUNNING') {
      await this.handleChannelRunning(channelId);
    } else if (state === 'IDLE') {
      await this.handleChannelIdle(channelId);
    }

    return { ok: true };
  }

  /**
   * Channel entered RUNNING — encoding is live, master.m3u8 is on S3.
   * Look up the content record by mediaLiveChannelId and mark it live.
   */
  private async handleChannelRunning(channelId: string) {
    try {
      await this.videoService.markStreamLiveByChannelId(channelId);
      this.logger.log(`Stream marked LIVE for channel: ${channelId}`);
    } catch (err) {
      this.logger.error(
        `Failed to mark stream live for channel ${channelId}: ${(err as any).message}`,
      );
    }
  }

  /**
   * Channel entered IDLE — either stopped normally or failed.
   * We don't call handleLiveStop() here because that's already triggered
   * by NodeMediaServer's donePublish event. This is just a safety net
   * for channels that stop unexpectedly on the AWS side.
   */
  private async handleChannelIdle(channelId: string) {
    try {
      await this.videoService.handleUnexpectedChannelStop(channelId);
      this.logger.log(`Handled unexpected channel stop: ${channelId}`);
    } catch (err) {
      this.logger.error(
        `Failed to handle channel idle for ${channelId}: ${(err as any).message}`,
      );
    }
  }

  /**
   * Called by the transcoder worker (future) when thumbnail is ready.
   * For now MediaLive doesn't generate thumbnails — this is a stub
   * for when you add a Lambda that captures a frame from the first segment.
   */
  @Post('stream/thumbnail')
  @HttpCode(200)
  async handleThumbnailReady(
    @Body() body: { contentId: string; thumbnailUrl: string },
    @Headers('x-webhook-secret') secret: string,
  ) {
    if (secret !== process.env.WEBHOOK_SECRET) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const { contentId, thumbnailUrl } = body;
    this.logger.log(`Thumbnail ready for content: ${contentId}`);

    await this.videoService.updateLiveThumbnailById(contentId, thumbnailUrl);
    return { ok: true };
  }

  /**
   * MediaConvert VOD job completion webhook.
   * EventBridge fires when a MediaConvert job reaches COMPLETE or ERROR state.
   */
  @Post('vod/mediaconvert-complete')
  @HttpCode(200)
  async handleMediaConvertComplete(
    @Body() event: any,
    @Headers('x-webhook-secret') secret: string,
  ) {
    if (secret !== process.env.WEBHOOK_SECRET) {
      this.logger.warn('Rejected MediaConvert webhook — invalid secret');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const detail = event.detail || {};
    const jobId = detail.jobId;
    const status = detail.status;
    const contentId = detail.userMetadata?.contentId;

    this.logger.log(
      `MediaConvert job ${jobId} completed with status: ${status}`,
    );

    if (status === 'COMPLETE' && contentId) {
      await this.videoService.handleMediaConvertComplete(contentId, jobId);
    } else if (status === 'ERROR' && contentId) {
      await this.videoService.handleMediaConvertError(contentId, jobId);
    }

    return { ok: true };
  }
}
