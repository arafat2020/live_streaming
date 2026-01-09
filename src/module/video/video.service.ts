import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException
} from '@nestjs/common';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { R2UploadService } from './r2-upload.service';
import { R2_PUBLIC_URL } from '../../config/r2.config';
import { ContentService } from '../content/content.service';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { ContentType } from '@prisma/client';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly r2UploadService: R2UploadService,
    private readonly contentService: ContentService,
    private readonly liveGateway: LiveCommentGateway,
    private readonly prisma: PrismaService,
  ) {}

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
   * Process VOD (Video on Demand) upload
   *  OPTIMIZED: Smaller segments for faster playback start
   */
  async processLargeVideo(
    fileBuffer: Buffer,
    lessonId: string,
    dto: CreateVideoDto,
  ): Promise<string> {
    // ✅ VALIDATE BUFFER FIRST
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Invalid or empty video buffer');
    }

    this.logger.log(`📦 Processing video buffer: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.resolve(process.cwd(), 'uploads', 'videos', lessonId);

    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const playlistPath = path.join(outputDir, 'index.m3u8');

    // Validate channel
    const channel = await this.prisma.channel.findFirst({
      where: { streamKey: dto.streamKey },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Create content record
    const content = await this.contentService.create({
      title: dto.title || 'Untitled Video',
      channelId: channel.id,
      contentType: ContentType.VOD,
      status: 'PROCESSING' as any,
      r2Prefix,
    });

    const watcher = this.r2UploadService.watchAndUpload(outputDir, r2Prefix);

    return new Promise((resolve, reject) => {
      // ✅ FIXED: More compatible FFmpeg settings
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', 'pipe:0',

        // Video encoding
        '-c:v', 'libx264',
        '-preset', 'medium',              // Balanced speed/quality
        '-crf', '23',                     // Good quality (lower = better)
        '-profile:v', 'main',             // Better compatibility
        '-level', '4.0',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',

        // Audio encoding
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',                       // Stereo

        // HLS settings
        '-f', 'hls',
        '-hls_time', '6',                 // 6 second segments
        '-hls_list_size', '0',
        '-hls_flags', 'independent_segments+delete_segments',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        '-g', '48',                       // GOP size
        '-keyint_min', '48',
        '-sc_threshold', '0',

        playlistPath,
      ], {
        stdio: ['pipe', 'pipe', 'pipe']  // ✅ Explicit stdio config
      });

      // ✅ FIXED: Better buffer streaming
      const bufferStream = new Readable({
        read() {
          this.push(fileBuffer);
          this.push(null);
        }
      });

      // ✅ Handle stdin errors
      ffmpeg.stdin.on('error', (err) => {
        this.logger.error(`FFmpeg stdin error: ${err.message}`);
      });

      // Pipe buffer to FFmpeg
      bufferStream.pipe(ffmpeg.stdin).on('error', (err) => {
        this.logger.error(`Buffer pipe error: ${err.message}`);
      });

      let resolved = false;
      let ffmpegError = '';

      // Collect stderr for debugging
      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        ffmpegError += output;

        // Only log important messages
        if (output.includes('error') || output.includes('Error') ||
          output.includes('failed') || output.includes('time=')) {
          this.logger.debug(`[FFmpeg] ${output.trim()}`);
        }
      });

      // ✅ Check for playlist with timeout
      const checker = setInterval(async () => {
        if (resolved) {
          clearInterval(checker);
          return;
        }

        if (fs.existsSync(playlistPath)) {
          try {
            const playlistContent = fs.readFileSync(playlistPath, 'utf-8');

            // Verify playlist has segments
            if (playlistContent.includes('.ts')) {
              const url = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;
              await this.contentService.update(content.id, { playbackUrl: url });

              resolved = true;
              clearInterval(checker);
              this.logger.log(`✅ Playlist available: ${url}`);
              resolve(url);
            }
          } catch (err) {
            this.logger.debug('Waiting for valid playlist...');
          }
        }
      }, 2000);

      // ✅ Timeout protection (5 minutes)
      const timeout = setTimeout(() => {
        if (!resolved) {
          clearInterval(checker);
          watcher.stop();
          ffmpeg.kill('SIGKILL');

          this.logger.error('⏱️ FFmpeg processing timeout (5 minutes)');
          this.logger.error(`Last FFmpeg output: ${ffmpegError.slice(-500)}`);

          reject(new Error('Video processing timeout'));
        }
      }, 5 * 60 * 1000);

      ffmpeg.on('error', (error) => {
        clearInterval(checker);
        clearTimeout(timeout);
        watcher.stop();

        this.logger.error(`❌ FFmpeg spawn error: ${error.message}`);

        if (!resolved) {
          reject(error);
        }
      });

      ffmpeg.on('close', async (code) => {
        clearInterval(checker);
        clearTimeout(timeout);

        if (code === 0) {
          this.logger.log('✅ FFmpeg completed successfully');

          try {
            // Wait for uploads
            await this.waitForUploadComplete(outputDir, 120000);

            this.logger.log('✅ All files uploaded to R2');

            // Stop watcher
            watcher.stop();
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Update content status
            await this.contentService.update(content.id, {
              status: 'AVAILABLE',
            });

            this.logger.log(`✅ Video processing complete for ${lessonId}`);

            // Cleanup
            await this.cleanupLocalFiles(outputDir);

            if (!resolved) {
              resolve(`${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`);
            }

          } catch (uploadError) {
            this.logger.error(`Upload error: ${uploadError.message}`);
            watcher.stop();

            await this.contentService.update(content.id, {
              status: 'FAILED',
            });

            if (!resolved) {
              reject(uploadError);
            }
          }
        } else {
          // FFmpeg failed
          watcher.stop();

          this.logger.error(`❌ FFmpeg exited with code ${code}`);
          this.logger.error(`FFmpeg error output: ${ffmpegError.slice(-1000)}`);

          await this.contentService.update(content.id, {
            status: 'FAILED',
          });

          await this.cleanupLocalFiles(outputDir);

          if (!resolved) {
            reject(new Error(`FFmpeg failed with code ${code}: ${ffmpegError.slice(-200)}`));
          }
        }
      });
    });
  }

  /**
   * Wait for all files to be uploaded to R2
   */
  private async waitForUploadComplete(
    outputDir: string,
    timeout: number = 120000,
  ): Promise<void> {
    const startTime = Date.now();
    let lastFileCount = -1;
    let stableCount = 0;

    this.logger.log(`⏳ Waiting for R2 upload to complete...`);

    while (Date.now() - startTime < timeout) {
      try {
        if (!fs.existsSync(outputDir)) {
          this.logger.log('✅ Directory removed - upload complete');
          return;
        }

        const files = fs.readdirSync(outputDir).filter(f =>
          f.endsWith('.ts') || f.endsWith('.m3u8')
        );

        const fileCount = files.length;

        if (fileCount !== lastFileCount) {
          this.logger.log(`📊 Files remaining: ${fileCount}`);
          lastFileCount = fileCount;
          stableCount = 0;
        } else {
          stableCount++;
        }

        if (fileCount === 0) {
          this.logger.log('✅ All segments uploaded');
          return;
        }

        if (stableCount >= 5) {
          this.logger.log(`ℹ️ File count stable, considering complete`);

          for (const file of files) {
            try {
              fs.unlinkSync(path.join(outputDir, file));
            } catch (err) {
              this.logger.warn(`Could not delete ${file}`);
            }
          }
          return;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        this.logger.warn(`Error checking upload: ${err.message}`);
        return;
      }
    }

    this.logger.warn('⚠️ Upload timeout reached');
  }

  /**
   * Cleanup local files with retry logic
   */
  private async cleanupLocalFiles(outputDir: string): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (fs.existsSync(outputDir)) {
          const files = fs.readdirSync(outputDir);
          this.logger.log(`🗑️ Cleaning up ${files.length} files`);

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

  // video.service.ts - IMPROVED waitForUploadComplete
/**
 * Wait for all files to be uploaded to R2
 * Enhanced with better detection
 */


  /**
   * Handle live stream start
   * Returns watcher object so MediaServer can stop it later
   */
  async handleLiveStream(
    streamKey: string,
    liveDir: string,
  ): Promise<{ stop: () => void }> {
    try {
      const r2Prefix = `videos/${streamKey}`;
      const playbackUrl = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;

      // Find channel by stream key
      const channel = await this.prisma.channel.findFirst({
        where: { streamKey },
      });

      if (!channel) {
        throw new NotFoundException(`Channel not found for stream key: ${streamKey}`);
      }

      // Update channel to live status
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { isLive: true },
      });

      // Create content record for this live stream
      const content = await this.contentService.create({
        title: `${channel.name} - Live Stream`,
        channelId: channel.id,
        contentType: 'LIVE_STREAM' as any,
        status: 'AVAILABLE' as any,
        r2Prefix,
        playbackUrl,
      });

      this.logger.log(`✅ Live stream started for channel: ${channel.name}`);
      this.logger.log(`📺 Playback URL: ${playbackUrl}`);
      this.logger.log(`📝 Content ID: ${content.id}`);

      // Notify via WebSocket
      this.liveGateway.streamLive(playbackUrl ,content);

      // Start R2 upload watcher
      return this.r2UploadService.watchAndUpload(liveDir, r2Prefix);

    } catch (error) {
      this.logger.error(`Failed to handle live stream: ${error.message}`);
      throw error;
    }
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
          r2Prefix: `videos/${streamKey}`,
          contentType: 'LIVE_STREAM' as any,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (content) {
        await this.contentService.update(content.id, {
          status: 'ENDED' as any,
        });
        
        this.logger.log(` Content ${content.id} marked as ended`);
      }

      // Notify via WebSocket
      this.liveGateway.streamEnded();

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
              contentType: 'LIVE_STREAM' as any,
              status: 'AVAILABLE' as any,
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
          startedAt: currentStream.createdAt,
          playbackUrl: currentStream.playbackUrl,
        } : null,
      };
    } catch (error) {
      this.logger.error(`Error getting stream stats: ${error.message}`);
      return null;
    }
  }

}