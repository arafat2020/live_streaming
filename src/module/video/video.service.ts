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
// import { ContentType } from '@prisma/client';
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

  /* =========================================================
     VOD (Large Video → HLS → R2)
     ========================================================= */
  async processLargeVideo(
    fileBuffer: Buffer,
    lessonId: string,
    dto: CreateVideoDto,
  ): Promise<string> {
    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.resolve(
      process.cwd(),
      'uploads',
      'videos',
      lessonId,
    );

    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'index.m3u8');

    const channel = await this.prisma.channel.findFirst({
      where: { streamKey: dto.streamKey },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const content = await this.contentService.create({
      title: dto.title || 'Untitled Video',
      channelId: channel.id,
      contentType: ContentType.VOD,
      status: 'PROCESSING' as any,
      r2Prefix,
    });

    // Start R2 watcher
    const watcher = this.r2UploadService.watchAndUpload(
      outputDir,
      r2Prefix,
    );

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i',
        'pipe:0',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-f',
        'hls',
        '-hls_time',
        '6',
        '-hls_list_size',
        '0',
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
            const url =
              `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;

            await this.contentService.update(content.id, {
              playbackUrl: url,
            });

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

  /* =========================================================
     LIVE STREAM START
     ========================================================= */
  async handleLiveStream(streamKey: string, liveDir: string) {
    const r2Prefix = `videos/${streamKey}`;
    const playbackUrl =
      `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;

    const channel = await this.prisma.channel.findFirst({
      where: { streamKey },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    await this.contentService.create({
      title: `Live Stream`,
      channelId: channel.id,
      contentType: 'LIVE_STREAM' as any,
      status: 'AVAILABLE' as any,
      r2Prefix,
      playbackUrl,
    });
    console.log(`Live Stream playbackUrl==================: ${playbackUrl}`);
    this.liveGateway.streamLive(playbackUrl);

    // IMPORTANT: return watcher so MediaServer can stop it
    return this.r2UploadService.watchAndUpload(
      liveDir,
      r2Prefix,
    );
  }

  /* =========================================================
     LIVE STREAM STOP
     ========================================================= */
  async handleLiveStop(streamKey: string) {
    const content = await this.prisma.content.findFirst({
      where: { r2Prefix: `videos/${streamKey}` },
    });

    if (!content) return;

    await this.contentService.update(content.id, {
      status: 'ENDED' as any,
    });

    this.liveGateway.streamEnded();
  }
}
