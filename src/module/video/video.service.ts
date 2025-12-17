import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { R2UploadService } from './r2-upload.service';
import { R2_PUBLIC_URL } from '../../config/r2.config';
import { ContentService } from '../content/content.service';
import { ContentType } from '@prisma/client';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly r2UploadService: R2UploadService,
    private readonly contentService: ContentService,
  ) {}

  async processLargeVideo(fileBuffer: Buffer, lessonId: string, dto: any): Promise<string> {
    const r2Prefix = `videos/${lessonId}`;
    const outputDir = path.join(process.cwd(), 'uploads', 'videos', lessonId);
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'index.m3u8');
    const hlsBaseUrl = `${R2_PUBLIC_URL}/${r2Prefix}/`;

    // ✅ এরর ফিক্স: contentType এবং অন্যান্য ফিল্ডগুলো সঠিকভাবে পাস করা হয়েছে
    const content = await this.contentService.create({
      title: dto.title || 'Untitled Video',
      channelId: "afddce5a-43df-475a-b896-ec92ac6ace5d",
      contentType: ContentType.VOD, // এই ফিল্ডটি মিসিং ছিল
      status: 'PROCESSING' as any,
      r2Prefix: r2Prefix,
    });
console.log("content--------->",content)
    const watcher = this.r2UploadService.watchAndUpload(outputDir, r2Prefix);

    return new Promise((resolve, reject) => {
      // pipe:0 ব্যবহার করে মেমোরি থেকে ডাটা নেওয়া হচ্ছে
      const ffmpeg = spawn('ffmpeg', [
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
      const checkInitialFiles = setInterval(async () => {
        if (fs.existsSync(playlistPath) && !isResolved) {
          try {
            const initialUrl = await this.r2UploadService.uploadPlaylist(playlistPath, `${r2Prefix}/index.m3u8`, r2Prefix);
            await this.contentService.update(content.id, { playbackUrl: initialUrl });
            isResolved = true;
            clearInterval(checkInitialFiles);
            resolve(initialUrl); 
          } catch (e) {
            this.logger.warn("Waiting for segments...");
          }
        }
      }, 5000);

      ffmpeg.on('close', async (code) => {
        watcher.close();
        clearInterval(checkInitialFiles);
        if (code === 0) {
          await this.contentService.update(content.id, { status: 'AVAILABLE' as any });
          // আপলোড শেষ হলে লোকাল চাঙ্কগুলো ডিলিট করুন (সার্ভার লোড কমাতে) 
          fs.rmSync(outputDir, { recursive: true, force: true });
        } else {
          await this.contentService.update(content.id, { status: 'FAILED' as any });
          if (!isResolved) reject(new Error('FFmpeg processing failed'));
        }
      });
 
    });
  }

async handleLiveStream(streamKey: string, liveDir: string) {
  // ✅ বাকেট পাথের সাথে মিল রেখে Prefix পরিবর্তন করুন
  const r2Prefix = `videos/${streamKey}`;
  const playbackUrl = `${R2_PUBLIC_URL}/${r2Prefix}/index.m3u8`;

  try {
    const content = await this.contentService.create({
      title: `Live Stream: ${streamKey}`,
      channelId: "afddce5a-43df-475a-b896-ec92ac6ace5d",
      contentType: "LIVE_STREAM" as any, 
      status: 'AVAILABLE' as any, 
      r2Prefix: r2Prefix,
      playbackUrl: playbackUrl,
    });

    this.logger.log(`✅ Database Record Created for videos bucket. ID: ${content.id}`);

    // ২. Cloudflare R2 ওয়াচার শুরু করুন
    this.r2UploadService.watchAndUpload(liveDir, r2Prefix);

  } catch (error) {
    this.logger.error(`❌ DB Error: ${error.message}`);
  }
}

}