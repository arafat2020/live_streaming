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
        '-y', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'hls', '-hls_time', '6', '-hls_list_size', '0',
        playlistPath,
      ]);

      const readable = new Readable();
      readable.push(fileBuffer);
      readable.push(null);
      readable.pipe(ffmpeg.stdin);

      let resolved = false;

      const checker = setInterval(async () => {
        if (fs.existsSync(playlistPath) && !resolved) {
          try {
            const url = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;
            await this.contentService.update(content.id, { playbackUrl: url });
            resolved = true;
            resolve(url);
            clearInterval(checker);
          } catch {
            this.logger.warn('Waiting for playlist...');
          }
        }
      }, 2000);

      ffmpeg.on('close', async (code) => {
        watcher.stop();
        clearInterval(checker);

        if (code === 0) {
          await this.contentService.update(content.id, {
            status: 'AVAILABLE' as any,
          });
        } else {
          await this.contentService.update(content.id, {
            status: 'FAILED' as any,
          });
          if (!resolved) reject(new Error('FFmpeg failed'));
        }

        if (fs.existsSync(outputDir)) {
          fs.rmSync(outputDir, { recursive: true, force: true });
        }
      });
    });
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
      await this.contentService.create({
        title: `${channel.name} - Live Stream`,
        channelId: channel.id,
        contentType: 'LIVE_STREAM' as any,
        status: 'AVAILABLE' as any,
        r2Prefix,
        playbackUrl,
      });

      this.logger.log(`✅ Live stream started for channel: ${channel.name}`);
      this.logger.log(`📺 Playback URL: ${playbackUrl}`);

      // Notify via WebSocket
      this.liveGateway.streamLive(playbackUrl);

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
      }

      // Update content status
      const content = await this.prisma.content.findFirst({
        where: { r2Prefix: `videos/${streamKey}` },
        orderBy: { createdAt: 'desc' },
      });

      if (content) {
        await this.contentService.update(content.id, {
          status: 'ENDED' as any,
        });
      }

      // Notify via WebSocket
      this.liveGateway.streamEnded();

      this.logger.log(`✅ Stream ${streamKey} ended successfully`);

    } catch (error) {
      this.logger.error(`Error handling stream stop: ${error.message}`);
    }
  }
}