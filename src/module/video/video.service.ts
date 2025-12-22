import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { R2UploadService } from './r2-upload.service';
import { R2_PUBLIC_URL } from '../../config/r2.config';
import { ContentService } from '../content/content.service';
import { ContentType } from '@prisma/client';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly r2UploadService: R2UploadService,
    private readonly contentService: ContentService,
    private readonly liveGateway: LiveCommentGateway,
    private prisma: PrismaService
  ) {}

  async processLargeVideo(fileBuffer: Buffer, lessonId: string, dto: CreateVideoDto): Promise<string> {
    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.join(process.cwd(), 'uploads', 'videos', lessonId);
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'index.m3u8');
    const hlsBaseUrl = `${R2_PUBLIC_URL}/${r2Prefix}/`;

    const channel = await this.prisma.channel.findFirst({ where: { streamKey: dto.streamKey } });
    if (!channel) throw new NotFoundException('Channel not found');

    const content = await this.contentService.create({
      title: dto.title || 'Untitled Video',
      channelId: channel.id,
      contentType: ContentType.VOD,
      status: 'PROCESSING' as any,
      r2Prefix,
    });

    const watcher = this.r2UploadService.watchAndUpload(outputDir, r2Prefix);

    return new Promise((resolve, reject) => {
      const ffmpegPath = '/usr/bin/ffmpeg';
      const ffmpeg = spawn(ffmpegPath, [
        '-y', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'hls', '-hls_time', '6', '-hls_list_size', '0',
        '-hls_base_url', hlsBaseUrl,
        playlistPath,
      ]);

      const stream = new Readable();
      stream.push(fileBuffer);
      stream.push(null);
      stream.pipe(ffmpeg.stdin);

      let isResolved = false;
      const checkFiles = setInterval(async () => {
        if (fs.existsSync(playlistPath) && !isResolved) {
          try {
            const initialUrl = await this.r2UploadService.uploadPlaylist(playlistPath, `${r2Prefix}/index.m3u8`, r2Prefix);
            await this.contentService.update(content.id, { playbackUrl: initialUrl });
            isResolved = true;
            clearInterval(checkFiles);
            resolve(initialUrl);
          } catch (e) {
            this.logger.warn('Waiting for segments...');
          }
        }
      }, 2000);

      ffmpeg.on('close', async (code) => {
        watcher.stop();
        clearInterval(checkFiles);
        if (code === 0) {
          await this.contentService.update(content.id, { status: 'AVAILABLE' as any });
          fs.rmSync(outputDir, { recursive: true, force: true });
        } else {
          await this.contentService.update(content.id, { status: 'FAILED' as any });
          if (!isResolved) reject(new Error('FFmpeg failed'));
        }
      });
    });
  }

  async handleLiveStream(streamKey: string, liveDir: string) {
    const r2Prefix = `videos/${streamKey}`;
    const playbackUrl = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;

    const channel = await this.prisma.channel.findFirst({ where: { streamKey } });
    if (!channel) throw new NotFoundException('Channel not found');

    const content = await this.contentService.create({
      title: `Live Stream: ${streamKey}`,
      channelId: channel.id,
      contentType: "LIVE_STREAM" as any,
      status: 'AVAILABLE' as any,
      r2Prefix,
      playbackUrl,
    });

    this.liveGateway.streamLive(playbackUrl);

    // Start R2 watcher
    this.r2UploadService.watchAndUpload(liveDir, r2Prefix);
  }

  async handleLiveStop(streamKey: string) {
    const content = await this.contentService.findOne(streamKey);
    if (!content) return;

    await this.contentService.update(content.id, { status: 'ENDED' as any });
    this.liveGateway.streamEnded();
  }
}
