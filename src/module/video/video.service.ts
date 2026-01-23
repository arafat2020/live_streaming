/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException
} from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ContentType, ContentStatus } from '@prisma/client';
import { R2UploadService } from './r2-upload.service';
import { R2_PUBLIC_URL } from '../../config/r2.config';
import { ContentService } from '../content/content.service';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';
import { ThumbnailService } from './thumbnail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly r2UploadService: R2UploadService,
    private readonly contentService: ContentService,
    private readonly liveGateway: LiveCommentGateway,
    private readonly prisma: PrismaService,
    private readonly thumbnailService: ThumbnailService,
  ) { }

  /**
   * Validate if a stream key exists and belongs to an active channel
   */
  async validateStreamKey(streamKey: string): Promise<boolean> {
    try {
      const channel = await this.prisma.channel.findUnique({
        where: { streamKey },
        select: { id: true, isLive: true },
      });

      if (!channel) {
        this.logger.warn(`Stream key not found: ${streamKey}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Error validating stream key: ${error.message}`);
      return false;
    }
  }

  /**
   * Initialize a live stream session and return a safe content ID
   * @param streamKey The secret stream key used for RTMP ingest
   * @returns Safe content ID and channel info
   */
  async initializeLiveStream(streamKey: string): Promise<{ contentId: string; channel: any }> {
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey },
      select: {
        id: true,
        name: true,
        category: true,
        pendingTitle: true,
        pendingDescription: true
      }
    });

    if (!channel) throw new NotFoundException('Channel not found');

    // Create the content record FIRST to get a public UUID/identity
    // This allows us to keep the streamKey private
    const content = await this.contentService.create({
      title: channel.pendingTitle || `${channel.name} - Live Stream`,
      description: channel.pendingDescription || undefined,
      channelId: channel.id,
      contentType: ContentType.LIVE_STREAM,
      status: ContentStatus.AVAILABLE,
      category: channel.category || undefined,
    });

    return { contentId: content.id, channel };
  }

  /**
   * Process VOD (Video on Demand) upload
   *  OPTIMIZED: Smaller segments for faster playback start
   */
  async processLargeVideo(
    lessonId: string,
    dto: CreateVideoDto,
    fileBuffer?: Buffer,
    inputPath?: string, // ✅ Allow passing a file path directly
  ): Promise<{ contentId: string; processingPromise: Promise<string> }> {
    // ✅ VALIDATE INPUT
    if (!fileBuffer && !inputPath) {
      throw new BadRequestException('Either fileBuffer or inputPath must be provided');
    }

    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.resolve(process.cwd(), 'uploads', 'videos', lessonId);

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const finalInputPath = inputPath || path.join(outputDir, 'input_video.tmp');

    // Save buffer to file if provided
    if (fileBuffer) {
      this.logger.log(`📦 Processing video buffer: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      fs.writeFileSync(finalInputPath, fileBuffer);
    } else {
      this.logger.log(`⚡ Processing existing file: ${inputPath}`);
    }

    // Validate input file
    if (!fs.existsSync(finalInputPath)) {
      throw new BadRequestException('Input video file not found');
    }

    const fileStats = fs.statSync(finalInputPath);
    if (fileStats.size === 0) {
      throw new BadRequestException('Input video file is empty');
    }

    this.logger.log(`📊 Input file size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

    // FFmpeg generation for VOD
    const processingPromise = (async () => {
      try {
        this.logger.log(`🎬 Starting FFmpeg for: ${lessonId}`);

        // Construct FFmpeg command
        const ffmpeg = spawn('ffmpeg', [
          '-y', // Overwrite output files without asking
          '-i', finalInputPath,
          '-err_detect', 'ignore_err', // Ignore errors in input
          '-fflags', '+genpts', // Generate presentation timestamps
          '-codec:v', 'libx264',
          '-preset', 'fast', // Faster encoding
          '-profile:v', 'main',
          '-level', '3.1',
          '-pix_fmt', 'yuv420p', // Ensure compatible pixel format
          '-codec:a', 'aac',
          '-ar', '44100',
          '-ac', '2',
          '-b:a', '128k', // Audio bitrate

          // ✅ OPTIMAL FOR WEB: 4-second segments
          '-start_number', '0',
          '-hls_time', '4',
          '-hls_list_size', '0',
          '-hls_segment_type', 'mpegts',
          '-f', 'hls',
          path.join(outputDir, 'index.m3u8'),
        ]);

        // Capture FFmpeg output for debugging
        let ffmpegOutput = '';
        let ffmpegError = '';

        ffmpeg.stdout?.on('data', (data) => {
          ffmpegOutput += data.toString();
        });

        ffmpeg.stderr?.on('data', (data) => {
          ffmpegError += data.toString();
        });

        return new Promise<string>((resolve, reject) => {
          ffmpeg.on('close', async (code) => {
            if (code === 0) {
              this.logger.log(`✅ Transcoding done: ${lessonId}`);

              // Upload result to R2
              const publicUrl = await this.uploadToR2(outputDir, r2Prefix);

              // Cleanup local files
              this.cleanupLocalFiles(outputDir);

              resolve(publicUrl);
            } else {
              this.logger.error(`❌ FFmpeg failed for ${lessonId} with code ${code}`);
              this.logger.error(`FFmpeg stderr: ${ffmpegError.slice(-500)}`); // Last 500 chars
              reject(new Error(`FFmpeg failed with code ${code}`));
            }
          });
        });
      } catch (err) {
        this.logger.error(`❌ Processing error: ${err.message}`);
        throw err;
      }
    })();

    // Find channel by streamKey to get channelId
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey: dto.streamKey },
      select: { id: true, name: true }
    });

    if (!channel) {
      throw new NotFoundException('Channel not found for the provided stream key');
    }

    // Create record in DB
    const content = await this.contentService.create({
      title: dto.title || `${channel.name} - Video`,
      description: dto.description,
      category: dto.category,
      channelId: channel.id,
      r2Prefix,
      contentType: ContentType.VOD,
      status: ContentStatus.PROCESSING,
    });

    return { contentId: content.id, processingPromise };
  }

  /**
   * Helper to upload entire folder to R2
   */
  private async uploadToR2(localDir: string, r2Prefix: string): Promise<string> {
    const files = fs.readdirSync(localDir);
    const m3u8File = files.find(f => f.endsWith('.m3u8'));

    for (const file of files) {
      const fullPath = path.join(localDir, file);
      const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';

      await this.r2UploadService.uploadFile(fullPath, `${r2Prefix}/${file}`, contentType);
    }

    return `${R2_PUBLIC_URL}/${r2Prefix}/${m3u8File}`;
  }

  /**
   * Wait for all files to be uploaded to R2
   * Enhanced with better detection
   */
  async waitForUploadComplete(localDir: string, timeout = 30000) {
    const startTime = Date.now();
    let lastFileCount = -1;
    let stableCount = 0;

    while (Date.now() - startTime < timeout) {
      const files = fs.readdirSync(localDir);
      const tsFiles = files.filter(f => f.endsWith('.ts'));

      if (tsFiles.length > 0 && tsFiles.length === lastFileCount) {
        stableCount++;
        if (stableCount >= 10) return true; // Stable for 1 second (10 * 100ms)
      } else {
        stableCount = 0;
      }

      lastFileCount = tsFiles.length;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  /**
   * Cleanup local transcoded files
   */
  async cleanupLocalFiles(outputDir: string, maxRetries = 5): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (fs.existsSync(outputDir)) {
          fs.rmSync(outputDir, { recursive: true, force: true });
          this.logger.log(`✅ Cleaned up: ${outputDir}`);
          return;
        } else {
          this.logger.log(`ℹ️ Already removed: ${outputDir}`);
          return;
        }
      } catch (err) {
        this.logger.warn(`⚠️ Cleanup attempt ${attempt} failed: ${err.message}`);

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  /**
   * Handle live stream start
   * This is called AFTER FFmpeg has started and a contentId has been assigned.
   */
  async handleLiveStream(
    contentId: string,
    liveDir: string,
  ): Promise<{ watcher: { stop: () => void } }> {
    try {
      // Use contentId for the R2 prefix to keep streamKey secret
      const r2Prefix = `live/${contentId}`;
      const playbackUrl = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;

      // Update the content record with the safe playback URL
      const content = await this.prisma.content.update({
        where: { id: contentId },
        data: {
          r2Prefix,
          playbackUrl,
        }
      });

      // Update channel to live status
      if (content.channelId) {
        await this.prisma.channel.update({
          where: { id: content.channelId },
          data: { isLive: true },
        });
      }

      this.logger.log(`📺 Safe Playback URL: ${playbackUrl}`);

      // Notify via WebSocket
      this.liveGateway.streamLive(playbackUrl, content);

      // Start R2 upload watcher
      const watcher = this.r2UploadService.watchAndUpload(liveDir, r2Prefix);
      return { watcher };

    } catch (error) {
      this.logger.error(`Failed to handle live stream start: ${error.message}`);
      throw error;
    }
  }

  /**
   * Broadcast live stats to viewers and creator
   */
  broadcastLiveStats(contentId: string, stats: any) {
    this.liveGateway.broadcastLiveStats(contentId, stats);
  }

  /**
   * Handle live stream stop
   */
  async handleLiveStop(streamKey: string): Promise<void> {
    try {
      // Find channel and update status
      const channel = await this.prisma.channel.findFirst({
        where: { streamKey },
      });

      if (channel) {
        await this.prisma.channel.update({
          where: { id: channel.id },
          data: { isLive: false },
        });

        this.logger.log(` Channel ${channel.name} marked as offline`);
      }

      // Update content status
      const content = await this.prisma.content.findFirst({
        where: {
          channelId: channel?.id,
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (content) {
        await this.contentService.update(content.id, {
          status: ContentStatus.ENDED,
        });

        this.logger.log(` Content ${content.id} marked as ended`);
      }

      // Notify via WebSocket
      this.liveGateway.streamEnded(content?.id);

      this.logger.log(` Stream ${streamKey} ended successfully`);

    } catch (error) {
      this.logger.error(`Error handling stream stop: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get stream statistics
   */
  async getStreamStats(streamKey: string) {
    try {
      const channel = await this.prisma.channel.findFirst({
        where: { streamKey },
        include: {
          content: {
            where: {
              contentType: 'LIVE_STREAM',
              status: 'AVAILABLE',
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!channel) {
        return null;
      }

      const currentStream = channel.content[0];

      return {
        channelId: channel.id,
        channelName: channel.name,
        isLive: channel.isLive,
        currentStream: currentStream ? {
          id: currentStream.id,
          title: currentStream.title,
          description: currentStream.description,
          startedAt: currentStream.createdAt,
          playbackUrl: currentStream.playbackUrl,
        } : null,
      };
    } catch (error) {
      this.logger.error(`Error getting stream stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Update the thumbnail URL for a live stream
   */
  async updateLiveThumbnail(streamKey: string, thumbnailUrl: string): Promise<void> {
    try {
      // We need to find the active content for this channel
      const channel = await this.prisma.channel.findUnique({ where: { streamKey } });
      if (!channel) return;

      const content = await this.prisma.content.findFirst({
        where: {
          channelId: channel.id,
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (content) {
        await this.prisma.content.update({
          where: { id: content.id },
          data: { thumbnailUrl },
        });

        this.logger.log(`✅ Updated thumbnail for live stream ${streamKey}: ${thumbnailUrl}`);
      } else {
        this.logger.warn(`⚠️ Could not find content for stream key ${streamKey} to update thumbnail`);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to update live thumbnail: ${error.message}`);
    }
  }

  /**
   * Emergency reset for stale streams (e.g. after server crash)
   * This is called on system startup to ensure no 'zombie' live sessions exist.
   */
  async resetStaleStreams(): Promise<void> {
    try {
      this.logger.log('🕵️ Checking for stale live streams...');

      // 1. Mark all channels as offline
      const resetChannels = await this.prisma.channel.updateMany({
        where: { isLive: true },
        data: { isLive: false }
      });

      // 2. Mark all ongoing live contents as ended
      const resetContent = await this.prisma.content.updateMany({
        where: {
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE
        },
        data: { status: ContentStatus.ENDED }
      });

      if (resetChannels.count > 0 || resetContent.count > 0) {
        this.logger.warn(`🧹 Cleaned up ${resetChannels.count} stale channels and ${resetContent.count} stale content records.`);
      } else {
        this.logger.log('✅ No stale streams found.');
      }
    } catch (error) {
      this.logger.error(`❌ Error during stale stream reset: ${error.message}`);
    }
  }

  /**
   * Update content status after successful processing
   */
  async updateContentAfterProcessing(contentId: string, playbackUrl: string): Promise<void> {
    try {
      await this.contentService.update(contentId, {
        status: ContentStatus.AVAILABLE,
        playbackUrl,
      });
      this.logger.log(`✅ Content ${contentId} updated to AVAILABLE with playback URL`);
    } catch (error) {
      this.logger.error(`❌ Failed to update content ${contentId}: ${error.message}`);
    }
  }
}