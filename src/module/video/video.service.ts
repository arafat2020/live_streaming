import {
  Injectable,
  Logger,
  NotFoundException,
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
   * ✅ OPTIMIZED: Smaller segments for faster playback start
   */
  async processLargeVideo(
    fileBuffer: Buffer,
    lessonId: string,
    dto: CreateVideoDto,
  ): Promise<string> {
    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.resolve(process.cwd(), 'uploads', 'videos', lessonId);

    fs.mkdirSync(outputDir, { recursive: true });

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
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'hls',
        
        // ✅ OPTIMIZED: 4-second segments (faster than 6s, reasonable for VOD)
        '-hls_time', '4',
        
        // Keep all segments (0 = unlimited)
        '-hls_list_size', '0',
        
        // ✅ OPTIMIZED: Add flags for better compatibility
        '-hls_flags', 'independent_segments',
        
        // ✅ OPTIMIZED: GOP size for 4-second segments (96 frames at 24fps)
        '-g', '96',
        '-keyint_min', '96',
        
        // ✅ OPTIMIZED: Disable scene change detection
        '-sc_threshold', '0',
        
        playlistPath,
      ]);

      const readable = new Readable();
      readable.push(fileBuffer);
      readable.push(null);
      readable.pipe(ffmpeg.stdin);

      let resolved = false;

      // Check for playlist availability
      const checker = setInterval(async () => {
        if (fs.existsSync(playlistPath) && !resolved) {
          try {
            const url = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;
            await this.contentService.update(content.id, { playbackUrl: url });
            resolved = true;
            resolve(url);
            clearInterval(checker);
            this.logger.log(`✅ Playlist available: ${url}`);
          } catch (err) {
            this.logger.debug('Waiting for playlist to be ready...');
          }
        }
      }, 2000);

      ffmpeg.stderr.on('data', (data) => {
        this.logger.debug(`[FFmpeg VOD] ${data.toString().trim()}`);
      });

      ffmpeg.on('error', (error) => {
        clearInterval(checker);
        watcher.stop();
        this.logger.error(`FFmpeg error: ${error.message}`);
        if (!resolved) reject(error);
      });

   ffmpeg.on('close', async (code) => {
  clearInterval(checker);
  
  if (code === 0) {
    this.logger.log('✅ FFmpeg completed successfully. Waiting for R2 upload...');
    
    // ✅ CRITICAL FIX: Wait for uploads BEFORE stopping watcher
    await this.waitForUploadComplete(outputDir, 120000);
    
    // ✅ CRITICAL FIX: Stop watcher AFTER uploads complete
    watcher.stop();

    await this.contentService.update(content.id, {
      status: 'AVAILABLE',
    });

    this.logger.log(`✅ Video processing complete for ${lessonId}`);
  } else {
    // ✅ On error, stop watcher immediately
    watcher.stop();
    this.logger.error(`FFmpeg exited with code ${code}`);
    await this.contentService.update(content.id, {
      status: 'FAILED',
    });
    if (!resolved) reject(new Error(`FFmpeg failed with code ${code}`));
  }

  // ✅ Delete local files AFTER everything is done
  setTimeout(() => {
    if (fs.existsSync(outputDir)) {
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
        this.logger.log(`🗑️ Cleaned up local files: ${outputDir}`);
      } catch (err) {
        this.logger.warn(`Failed to delete ${outputDir}: ${err.message}`);
      }
    }
  }, 10000);
});
    });
  }

  /**
   * Wait for all files to be uploaded to R2
   * ✅ Enhanced with better logging and timeout handling
   */
  private async waitForUploadComplete(
    outputDir: string,
    //timeout: number = 60000,
    timeout: number = 120000,
  ): Promise<void> {
    const startTime = Date.now();
    let lastFileCount = -1;

    this.logger.log(`⏳ Waiting for R2 upload to complete...`);

    while (Date.now() - startTime < timeout) {
      try {
        if (!fs.existsSync(outputDir)) {
          this.logger.log('✅ Directory removed - upload complete');
          return;
        }

        // Check if any .ts or .m3u8 files still exist
        const files = fs.readdirSync(outputDir).filter(f => 
          f.endsWith('.ts') || f.endsWith('.m3u8')
        );
        
        const fileCount = files.length;
        
        // Log progress if file count changed
        if (fileCount !== lastFileCount) {
          this.logger.log(`📊 Files remaining: ${fileCount}`);
          lastFileCount = fileCount;
        }

        if (fileCount === 0) {
          this.logger.log('✅ All segments uploaded to R2');
          return;
        }

        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        this.logger.warn(`Error checking upload status: ${err.message}`);
        return;
      }
    }

    this.logger.warn('⚠️ Upload timeout reached, proceeding anyway');
  }

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
        
        this.logger.log(`✅ Channel ${channel.name} marked as offline`);
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
        
        this.logger.log(`✅ Content ${content.id} marked as ended`);
      }

      // Notify via WebSocket
      this.liveGateway.streamEnded();

      this.logger.log(`✅ Stream ${streamKey} ended successfully`);

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