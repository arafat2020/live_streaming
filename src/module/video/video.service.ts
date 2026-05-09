import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Category, ContentStatus, ContentType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';
import { ContentService } from '../content/content.service';
import { MediaConvertService } from './media-convert.service';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly liveGateway: LiveCommentGateway,
    private readonly prisma: PrismaService,
    private readonly mediaConvertService: MediaConvertService,
  ) {}

  // ==========================================
  // 1. LIVE STREAM LIFE CYCLE
  // ==========================================

  /**
   * Initialize a new live stream session.
   * Called by MediaServerService when a new RTMP push is detected.
   */
  async handleLiveStart(streamKey: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey },
      select: { 
        id: true, 
        name: true, 
        category: true, 
        pendingDescription: true, 
        pendingTitle: true 
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found for this stream key');
    }

    const streamCategory = channel.category || Category.JUST_CHATTING;

    // Create a new content record in PROCESSING state
    const content = await this.contentService.create({
      title: channel.pendingTitle || `${channel.name} - Live Stream`,
      description: channel.pendingDescription || undefined,
      channelId: channel.id,
      contentType: ContentType.LIVE_STREAM,
      status: ContentStatus.PROCESSING,
      category: streamCategory,
    });

    return { contentId: content.id, channel };
  }

  /**
   * Handle graceful live stream termination.
   * Called when RTMP connection is closed.
   */
  async handleLiveStop(streamKey: string): Promise<void> {
    try {
      const channel = await this.prisma.channel.findFirst({
        where: { streamKey },
      });

      if (channel) {
        await this.prisma.channel.update({
          where: { id: channel.id },
          data: { isLive: false },
        });
      }

      const content = await this.prisma.content.findFirst({
        where: {
          channelId: channel?.id,
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (content) {
        const durationSeconds = Math.floor(
          (Date.now() - content.createdAt.getTime()) / 1000,
        );

        await this.contentService.update(content.id, {
          status: ContentStatus.ENDED,
          durationSeconds: durationSeconds,
        });
      }

      this.liveGateway.streamEnded(content?.id);
    } catch (error) {
      this.logger.error(`Error handling stream stop: ${error.message}`);
      throw error;
    }
  }

  /**
   * Emergency reset for stale streams (e.g. on server restart).
   */
  async resetStaleStreams(): Promise<void> {
    try {
      await this.prisma.channel.updateMany({
        where: { isLive: true },
        data: { isLive: false },
      });

      await this.prisma.content.updateMany({
        where: {
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE,
        },
        data: { status: ContentStatus.ENDED },
      });
      this.logger.log('✅ Stale streams reset successfully');
    } catch (error) {
      this.logger.error(`❌ Error during stale stream reset: ${error.message}`);
    }
  }

  // ==========================================
  // 2. AWS MEDIALIVE OPERATIONS
  // ==========================================

  /**
   * Stores the AWS MediaLive channelId on the Content record.
   */
  async setMediaLiveChannelId(
    contentId: string,
    channelId: string,
    inputId: string,
  ): Promise<void> {
    await this.prisma.content.update({
      where: { id: contentId },
      data: {
        mediaLiveChannelId: channelId,
        mediaLiveInputId: inputId,
      },
    });
  }

  /**
   * Marks a stream as LIVE (AVAILABLE) when AWS EventBridge signals RUNNING.
   */
  async markStreamLiveByChannelId(channelId: string): Promise<void> {
    let content = await this.prisma.content.findFirst({
      where: {
        mediaLiveChannelId: channelId,
        contentType: ContentType.LIVE_STREAM,
        status: ContentStatus.PROCESSING,
      },
    });

    // RETRY logic: Handles race conditions where webhook arrives faster than DB update
    if (!content) {
      this.logger.log(`markStreamLiveByChannelId: content not found for ${channelId}, retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
      content = await this.prisma.content.findFirst({
        where: {
          mediaLiveChannelId: channelId,
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.PROCESSING,
        },
      });
    }

    if (!content) {
      this.logger.warn(
        `markStreamLiveByChannelId: no PROCESSING content found for channelId ${channelId}`,
      );
      return;
    }

    const playbackUrl = `${process.env.CLOUDFRONT_URL}/live/${content.id}/master.m3u8`;

    await this.prisma.content.update({
      where: { id: content.id },
      data: {
        playbackUrl,
        status: ContentStatus.AVAILABLE,
      },
    });

    if (content.channelId) {
      await this.prisma.channel.update({
        where: { id: content.channelId },
        data: { isLive: true },
      });
    }

    this.liveGateway.streamLive(playbackUrl, content);
  }

  /**
   * Handle AWS MediaLive channel unexpected stops.
   */
  async handleUnexpectedChannelStop(channelId: string): Promise<void> {
    const content = await this.prisma.content.findFirst({
      where: {
        mediaLiveChannelId: channelId,
        contentType: ContentType.LIVE_STREAM,
        status: ContentStatus.AVAILABLE,
      },
    });

    if (!content) return;

    await this.contentService.update(content.id, {
      status: ContentStatus.ENDED,
    });

    if (content.channelId) {
      await this.prisma.channel.update({
        where: { id: content.channelId },
        data: { isLive: false },
      });
    }

    this.liveGateway.streamEnded(content.id);
  }

  // ==========================================
  // 3. VOD (VIDEO ON DEMAND) OPERATIONS
  // ==========================================

  /**
   * Process a large video upload via AWS MediaConvert.
   */
  async processLargeVideo(
    lessonId: string,
    dto: CreateVideoDto,
    fileBuffer?: Buffer,
    inputPath?: string,
  ): Promise<{
    contentId: string;
    processingPromise: Promise<{ playbackUrl: string; thumbnailUrl: string }>;
  }> {
    if (!fileBuffer && !inputPath) {
      throw new BadRequestException('Either fileBuffer or inputPath must be provided');
    }

    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.resolve(process.cwd(), 'uploads', 'videos', lessonId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const finalInputPath = inputPath || path.join(outputDir, 'input_video.tmp');

    if (fileBuffer) {
      fs.writeFileSync(finalInputPath, fileBuffer);
    }

    const channel = await this.prisma.channel.findUnique({
      where: { streamKey: dto.streamKey },
      select: { id: true, name: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const content = await this.contentService.create({
      title: dto.title || `${channel.name} - Video`,
      description: dto.description,
      category: dto.category as Category,
      channelId: channel.id,
      r2Prefix,
      contentType: ContentType.VOD,
      status: ContentStatus.PROCESSING,
    });

    const processingPromise = (async () => {
      try {
        this.logger.log(`🎬 Submitting MediaConvert job for: ${lessonId}`);

        const s3Key = `uploads/${lessonId}/${path.basename(finalInputPath)}`;
        const inputS3Path = await this.mediaConvertService.uploadFileToS3(
          finalInputPath,
          s3Key,
        );

        const result = await this.mediaConvertService.submitTranscodingJob({
          contentId: content.id,
          inputS3Path,
        });

        this.logger.log(`✅ MediaConvert job submitted: ${result.jobId}`);
        const playbackUrl = `${process.env.CLOUDFRONT_URL}/videos/${content.id}/master.m3u8`;

        return { playbackUrl, thumbnailUrl: '' };
      } catch (err) {
        this.logger.error(`❌ MediaConvert submission error: ${err.message}`);
        throw err;
      }
    })();

    return { contentId: content.id, processingPromise };
  }

  /**
   * Called when AWS MediaConvert job is successfully completed.
   */
  async handleMediaConvertComplete(contentId: string, jobId: string): Promise<void> {
    try {
      const playbackUrl = `${process.env.CLOUDFRONT_URL}/videos/${contentId}/master.m3u8`;
      await this.prisma.content.update({
        where: { id: contentId },
        data: {
          playbackUrl,
          status: ContentStatus.AVAILABLE,
          mediaConvertJobId: jobId,
        },
      });
      this.logger.log(`✅ VOD Content ${contentId} is now AVAILABLE`);
    } catch (error) {
      this.logger.error(`Failed to handle MediaConvert completion: ${error.message}`);
    }
  }

  /**
   * Called when AWS MediaConvert job fails.
   */
  async handleMediaConvertError(contentId: string, jobId: string): Promise<void> {
    try {
      await this.prisma.content.update({
        where: { id: contentId },
        data: {
          status: ContentStatus.FAILED,
          mediaConvertJobId: jobId,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to handle MediaConvert error: ${error.message}`);
    }
  }

  // ==========================================
  // 4. ANALYTICS & STATS
  // ==========================================

  /**
   * Broadcast live statistics to all viewers.
   */
  broadcastLiveStats(contentId: string, stats: any) {
    this.liveGateway.broadcastLiveStats(contentId, stats);
  }

  /**
   * Retrieve current stream statistics by stream key.
   */
  async getStreamStats(streamKey: string) {
    try {
      const channel = await this.prisma.channel.findUnique({
        where: { streamKey },
      });

      if (!channel) return null;

      const currentStream = await this.prisma.content.findFirst({
        where: {
          channelId: channel.id,
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        isLive: channel.isLive,
        currentStream: currentStream || null,
      };
    } catch (error) {
      this.logger.error(`Error getting stream stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Update content metadata after processing is complete.
   */
  async updateContentAfterProcessing(
    contentId: string,
    playbackUrl: string,
    thumbnailUrl?: string,
  ): Promise<void> {
    try {
      await this.contentService.update(contentId, {
        status: ContentStatus.AVAILABLE,
        playbackUrl,
        ...(thumbnailUrl && { thumbnailUrl }),
      });
    } catch (error) {
      this.logger.error(`Failed to update content after processing: ${error.message}`);
    }
  }

  /**
   * Update thumbnail for a live stream.
   */
  async updateLiveThumbnailById(
    contentId: string,
    thumbnailUrl: string,
  ): Promise<void> {
    await this.prisma.content.update({
      where: { id: contentId },
      data: { thumbnailUrl },
    });
  }
}
