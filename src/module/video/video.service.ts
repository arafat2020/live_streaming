import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Category, ContentStatus, ContentType } from '@prisma/client';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { R2_PUBLIC_URL } from '../../config/r2.config';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from '../content/content.service';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';
import { CreateVideoDto } from './dto/create-video.dto';
import { R2UploadService } from './r2-upload.service';
import { ThumbnailService } from './thumbnail.service';
import { VIDEO_RENDITIONS } from '../../common/video.constants';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  private async getInputMetadata(inputPath: string): Promise<{ hasAudio: boolean; duration: number }> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'json',
        inputPath,
      ]);

      let out = '';
      ffprobe.stdout?.on('data', (d) => {
        out += d.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          resolve({ hasAudio: false, duration: 0 });
          return;
        }

        try {
          const parsed = JSON.parse(out);
          const streams = parsed?.streams || [];
          const hasAudio = streams.some((s: any) => s.codec_type === 'audio');
          const duration = parseFloat(parsed?.format?.duration || '0');
          resolve({ hasAudio, duration });
        } catch {
          resolve({ hasAudio: false, duration: 0 });
        }
      });

      ffprobe.on('error', () => resolve({ hasAudio: false, duration: 0 }));
    });
  }

  private listFilesRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listFilesRecursive(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

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
  async initializeLiveStream(
    streamKey: string,
  ): Promise<{ contentId: string; channel: any }> {
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey },
      select: {
        id: true,
        name: true,
        category: true,
        pendingTitle: true,
        pendingDescription: true,
      },
    });

    if (!channel) throw new NotFoundException('Channel not found');

    // Requirement: Every stream must have exactly one category.
    // If null or invalid, auto-set to JUST_CHATTING.
    const streamCategory = channel.category || 'JUST_CHATTING';

    // Create the content record FIRST to get a public UUID/identity
    // This allows us to keep the streamKey private
    const content = await this.contentService.create({
      title: channel.pendingTitle || `${channel.name} - Live Stream`,
      description: channel.pendingDescription || undefined,
      channelId: channel.id,
      contentType: ContentType.LIVE_STREAM,
      status: ContentStatus.AVAILABLE,
      category: streamCategory,
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
  ): Promise<{
    contentId: string;
    processingPromise: Promise<{ playbackUrl: string; thumbnailUrl: string }>;
  }> {
    // ✅ VALIDATE INPUT
    if (!fileBuffer && !inputPath) {
      throw new BadRequestException(
        'Either fileBuffer or inputPath must be provided',
      );
    }

    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.resolve(
      process.cwd(),
      'uploads',
      'videos',
      lessonId,
    );

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const finalInputPath = inputPath || path.join(outputDir, 'input_video.tmp');

    // Save buffer to file if provided
    if (fileBuffer) {
      this.logger.log(
        `📦 Processing video buffer: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`,
      );
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

    this.logger.log(
      `📊 Input file size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`,
    );

    // Generate thumbnail from the original input video BEFORE processing
    let thumbnailUrl = '';
    try {
      this.logger.log(
        `📸 Generating thumbnail from original video: ${lessonId}...`,
      );
      thumbnailUrl = await this.thumbnailService.generateThumbnailFromSegment(
        finalInputPath,
        r2Prefix,
        lessonId,
      );
      this.logger.log(`✅ Thumbnail generated: ${thumbnailUrl}`);
    } catch (thumbErr) {
      this.logger.error(`❌ Thumbnail generation failed: ${thumbErr.message}`);
      // Continue without thumbnail - not critical
    }

    // FFmpeg generation for VOD (ABR HLS)
    const processingPromise = (async () => {
      try {
        this.logger.log(`🎬 Starting FFmpeg for: ${lessonId}`);

        const { hasAudio: inputHasAudio, duration } = await this.getInputMetadata(
          finalInputPath,
        );
        if (!inputHasAudio) {
          this.logger.warn(
            `⚠️ No audio stream detected for ${lessonId}. Injecting silent audio track for HLS packaging.`,
          );
        }

        const masterPlaylistName = 'master.m3u8';

        // ABR ladder (keep moderate by default)
        // Note: bitrates are targets; actual may vary.
        const renditions = VIDEO_RENDITIONS;

        // Ensure per-rendition folders exist
        for (const r of renditions) {
          const dir = path.join(outputDir, r.name);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }

        const filterParts = renditions
          .map((r, idx) => {
            const scale = `scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2`;
            // Reset timestamps to start from 0 to prevent synchronization issues with generated audio
            return `[0:v]setpts=PTS-STARTPTS,${scale}[v${idx}]`;
          })
          .join(';');

        const varStreamMap = renditions
          .map((r, idx) => `v:${idx},a:${idx},name:${r.name}`)
          .join(' ');

        const ffmpegArgs: string[] = [
          '-y',
          '-i',
          finalInputPath,
          '-err_detect',
          'ignore_err',
          '-fflags',
          '+genpts',
          ...(inputHasAudio
            ? []
            : [
              '-f',
              'lavfi',
              ...(duration > 0 ? ['-t', duration.toString()] : []),
              '-i',
              'anullsrc=channel_layout=stereo:sample_rate=44100',
            ]),
          '-filter_complex',
          filterParts,
        ];

        // Map video/audio for each rendition
        renditions.forEach((_r, idx) => {
          ffmpegArgs.push('-map', `[v${idx}]`);
          ffmpegArgs.push('-map', inputHasAudio ? '0:a:0?' : '1:a:0');
        });

        // Per-stream encoding settings
        renditions.forEach((r, idx) => {
          ffmpegArgs.push(`-c:v:${idx}`, 'libx264');
          ffmpegArgs.push(`-preset`, 'fast');
          ffmpegArgs.push(`-profile:v:${idx}`, 'main');
          ffmpegArgs.push(`-pix_fmt`, 'yuv420p');
          ffmpegArgs.push(`-b:v:${idx}`, r.vBitrate);
          ffmpegArgs.push(`-maxrate:v:${idx}`, r.maxrate);
          ffmpegArgs.push(`-bufsize:v:${idx}`, r.bufsize);
          ffmpegArgs.push(`-g:${idx}`, '48');
          ffmpegArgs.push(`-keyint_min:${idx}`, '48');
          ffmpegArgs.push(`-sc_threshold:${idx}`, '0');

          ffmpegArgs.push(`-c:a:${idx}`, 'aac');
          ffmpegArgs.push(`-b:a:${idx}`, r.aBitrate);
          ffmpegArgs.push(`-ac:${idx}`, '2');
          ffmpegArgs.push(`-ar:${idx}`, '44100');
        });

        // HLS options
        ffmpegArgs.push(
          '-f',
          'hls',
          '-hls_time',
          '2',
          '-hls_list_size',
          '10',
          '-hls_flags',
          'delete_segments+independent_segments+program_date_time',
          '-hls_playlist_type',
          'event',
          '-start_number',
          '0',
          '-master_pl_name',
          masterPlaylistName,
          '-var_stream_map',
          varStreamMap,
          '-hls_segment_filename',
          path.join('%v', '%03d.ts').replace(/\\/g, '/'),
          path.join('%v', 'index.m3u8').replace(/\\/g, '/'),
        );

        if (!inputHasAudio) {
          // Ensure the generated silent audio doesn't outlive the video
          ffmpegArgs.push('-shortest');
          if (duration > 0) {
            ffmpegArgs.push('-t', duration.toString());
          }
        }

        this.logger.log(
          `🎬 FFmpeg args (${lessonId}): ${['ffmpeg', ...ffmpegArgs].join(' ')}`,
        );

        const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
          // Important: output paths use "%v/..." (relative), so run FFmpeg inside outputDir
          cwd: outputDir,
        });

        // Capture FFmpeg output for debugging
        let ffmpegOutput = '';
        let ffmpegError = '';
        let lastProgressLogAt = 0;

        ffmpeg.stdout?.on('data', (data) => {
          ffmpegOutput += data.toString();
        });

        ffmpeg.stderr?.on('data', (data) => {
          const msg = data.toString();
          ffmpegError += msg;

          // Throttled progress logging (FFmpeg emits lines like: time=00:00:10.00)
          if (msg.includes('time=')) {
            const now = Date.now();
            if (now - lastProgressLogAt > 30000) {
              lastProgressLogAt = now;
              this.logger.log(
                `⏳ FFmpeg progress (${lessonId}): ${msg.trim().slice(-200)}`,
              );
            }
          }
        });

        return new Promise<{ playbackUrl: string; thumbnailUrl: string }>(
          (resolve, reject) => {
            ffmpeg.on('close', async (code) => {
              if (code === 0) {
                this.logger.log(`✅ Transcoding done: ${lessonId}`);

                // Upload ABR output to R2 (recursive)
                const playbackUrl = await this.uploadToR2(outputDir, r2Prefix);

                // Cleanup local files
                this.cleanupLocalFiles(outputDir);

                this.logger.log(
                  `✅ Upload complete. Processing started for content: ${playbackUrl}`,
                  JSON.stringify({ playbackUrl, thumbnailUrl }),
                );

                resolve({ playbackUrl, thumbnailUrl });
              } else {
                this.logger.error(
                  `❌ FFmpeg failed for ${lessonId} with code ${code}`,
                );
                const stderrTail = ffmpegError.slice(-4000);
                this.logger.error(`FFmpeg stderr (tail): ${stderrTail}`);
                reject(new Error(`FFmpeg failed with code ${code}`));
              }
            });
          },
        );
      } catch (err) {
        this.logger.error(`❌ Processing error: ${err.message}`);
        throw err;
      }
    })();

    // Find channel by streamKey to get channelId
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey: dto.streamKey },
      select: { id: true, name: true },
    });

    if (!channel) {
      throw new NotFoundException(
        'Channel not found for the provided stream key',
      );
    }

    // Create record in DB
    const content = await this.contentService.create({
      title: dto.title || `${channel.name} - Video`,
      description: dto.description,
      category: dto.category as Category,
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
  private async uploadToR2(
    localDir: string,
    r2Prefix: string,
  ): Promise<string> {
    const allFiles = this.listFilesRecursive(localDir);

    const getR2KeyFromLocalPath = (localPath: string) => {
      const relative = path.relative(localDir, localPath).replace(/\\/g, '/');
      return `${r2Prefix}/${relative}`;
    };

    // Upload segments first
    const tsFiles = allFiles.filter((f) => f.endsWith('.ts'));
    for (const filePath of tsFiles) {
      await this.r2UploadService.uploadFile(
        filePath,
        getR2KeyFromLocalPath(filePath),
        'video/mp2t',
      );
    }

    // Then playlists
    const m3u8Files = allFiles.filter((f) => f.endsWith('.m3u8'));
    for (const filePath of m3u8Files) {
      await this.r2UploadService.uploadPlaylist(
        filePath,
        getR2KeyFromLocalPath(filePath),
      );
    }

    const masterLocalPath = path.join(localDir, 'master.m3u8');
    const masterR2Key = `${r2Prefix}/master.m3u8`;
    if (fs.existsSync(masterLocalPath)) {
      return `${R2_PUBLIC_URL}/${masterR2Key}`;
    }

    // Fallback: if master isn't present, keep legacy behavior
    const anyM3u8 = m3u8Files[0];
    if (!anyM3u8) {
      throw new Error('No HLS playlist (.m3u8) generated');
    }
    return `${R2_PUBLIC_URL}/${getR2KeyFromLocalPath(anyM3u8)}`;
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
      const tsFiles = files.filter((f) => f.endsWith('.ts'));

      if (tsFiles.length > 0 && tsFiles.length === lastFileCount) {
        stableCount++;
        if (stableCount >= 10) return true; // Stable for 1 second (10 * 100ms)
      } else {
        stableCount = 0;
      }

      lastFileCount = tsFiles.length;
      await new Promise((resolve) => setTimeout(resolve, 100));
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
        this.logger.warn(
          `⚠️ Cleanup attempt ${attempt} failed: ${err.message}`,
        );

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
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
      const playbackUrl = `${R2_PUBLIC_URL}/${r2Prefix}/master.m3u8`;

      // 1. Start R2 upload watcher immediately so it can begin uploading segments/manifest
      const watcher = this.r2UploadService.watchAndUpload(liveDir, r2Prefix);

      // 2. WAIT for the manifest to actually appear on R2 before marking as LIVE
      // This prevents the frontend from getting a 404 if it tries to play immediately
      this.logger.log(
        `⏳ Waiting for manifest to be available on R2: ${playbackUrl}`,
      );

      const manifestKey = `${r2Prefix}/master.m3u8`;
      let isAvailable = false;
      let attempts = 0;
      const maxAttempts = 100; // Total 20 seconds timeout (100 * 200ms)

      while (attempts < maxAttempts) {
        const exists = await this.r2UploadService.fileExists(manifestKey);
        if (exists) {
          isAvailable = true;
          this.logger.log(
            `✅ Manifest is now available on R2 after ${attempts * 0.2}s`,
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        attempts++;
      }

      if (!isAvailable) {
        this.logger.warn(
          `⚠️ Manifest not found on R2 after ${maxAttempts}s. Proceeding anyway, but playback might fail initially.`,
        );
      }

      // 3. Update the content record with the safe playback URL
      const content = await this.prisma.content.update({
        where: { id: contentId },
        data: {
          r2Prefix,
          playbackUrl,
          status: ContentStatus.AVAILABLE,
        },
      });

      // 4. Update channel to live status
      if (content.channelId) {
        await this.prisma.channel.update({
          where: { id: content.channelId },
          data: { isLive: true },
        });
      }

      this.logger.log(`📺 Safe Playback URL: ${playbackUrl}`);

      // 5. Notify via WebSocket
      this.liveGateway.streamLive(playbackUrl, content);

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
        // Calculate duration in seconds
        const durationSeconds = Math.floor(
          (Date.now() - content.createdAt.getTime()) / 1000,
        );

        await this.contentService.update(content.id, {
          status: ContentStatus.ENDED,
          durationSeconds: durationSeconds,
        });

        this.logger.log(
          ` Content ${content.id} marked as ended. Duration: ${durationSeconds}s`,
        );
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
        currentStream: currentStream
          ? {
            id: currentStream.id,
            title: currentStream.title,
            description: currentStream.description,
            startedAt: currentStream.createdAt,
            playbackUrl: currentStream.playbackUrl,
          }
          : null,
      };
    } catch (error) {
      this.logger.error(`Error getting stream stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Update the thumbnail URL for a live stream
   */
  async updateLiveThumbnail(
    streamKey: string,
    thumbnailUrl: string,
  ): Promise<void> {
    try {
      // We need to find the active content for this channel
      const channel = await this.prisma.channel.findUnique({
        where: { streamKey },
      });
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

        this.logger.log(
          `✅ Updated thumbnail for live stream ${streamKey}: ${thumbnailUrl}`,
        );
      } else {
        this.logger.warn(
          `⚠️ Could not find content for stream key ${streamKey} to update thumbnail`,
        );
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
        data: { isLive: false },
      });

      // 2. Mark all ongoing live contents as ended
      const resetContent = await this.prisma.content.updateMany({
        where: {
          contentType: ContentType.LIVE_STREAM,
          status: ContentStatus.AVAILABLE,
        },
        data: { status: ContentStatus.ENDED },
      });

      if (resetChannels.count > 0 || resetContent.count > 0) {
        this.logger.warn(
          `🧹 Cleaned up ${resetChannels.count} stale channels and ${resetContent.count} stale content records.`,
        );
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
      this.logger.log(
        `✅ Content ${contentId} updated to AVAILABLE with playback URL ${playbackUrl ? ' and thumbnail' : `${thumbnailUrl}`}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to update content ${contentId}: ${error.message}`,
      );
    }
  }
}
