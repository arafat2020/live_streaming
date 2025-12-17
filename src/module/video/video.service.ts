// import { Injectable, Logger } from '@nestjs/common';
// import { spawn } from 'child_process';
// import * as fs from 'fs';
// import * as path from 'path';
// import { R2UploadService } from './r2-upload.service';
// import { R2_PUBLIC_URL } from '../../config/r2.config'; // কনফিগার থেকে ইম্পোর্ট করুন

// @Injectable()
// export class VideoService {
//   private readonly logger = new Logger(VideoService.name);
//   private readonly FFMPEG_PATH = 'ffmpeg';

//   constructor(private readonly r2UploadService: R2UploadService) {}

//   async transcodeVideoToHLS(videoPath: string, lessonId: string): Promise<string> {
//     const outputDir = path.join(process.cwd(), 'uploads', 'videos', lessonId);
//     fs.mkdirSync(outputDir, { recursive: true });

//     const playlistPath = path.join(outputDir, 'index.m3u8');
//     const segmentPattern = path.join(outputDir, 'segment_%03d.ts');
//     const r2Prefix = `videos/${lessonId}`;
    
//     // সেগমেন্টের জন্য বেস ইউআরএল
//     const hlsBaseUrl = `${R2_PUBLIC_URL}/${r2Prefix}/`;

//     const watcher = this.r2UploadService.watchAndUpload(outputDir, r2Prefix);

//     return new Promise((resolve, reject) => {
//       const ffmpeg = spawn(this.FFMPEG_PATH, [
//         '-y', '-i', path.resolve(videoPath),
//         '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
//         '-c:a', 'aac', '-b:a', '128k',
//         '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
//         '-hls_base_url', hlsBaseUrl, // 🚨 এটিই আপনার ডোমেইন এরর ঠিক করবে
//         '-hls_segment_filename', segmentPattern,
//         playlistPath,
//       ]);

//       ffmpeg.on('close', async (code) => {
//         watcher.close();
//         if (code === 0) {
//           await this.r2UploadService.uploadSegments(outputDir, r2Prefix);
//           const finalUrl = await this.r2UploadService.uploadPlaylist(playlistPath, `${r2Prefix}/index.m3u8`, r2Prefix);
//           resolve(finalUrl);
//         } else {
//           reject(new Error('FFmpeg failed'));
//         }
//       });
//     });
//   }
// }



import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { R2UploadService } from './r2-upload.service';
import { R2_PUBLIC_URL } from '../../config/r2.config';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly FFMPEG_PATH = 'ffmpeg';

  constructor(private readonly r2UploadService: R2UploadService) {}

  async transcodeVideoToHLS(videoPath: string, lessonId: string): Promise<string> {
    const outputDir = path.join(process.cwd(), 'uploads', 'videos', lessonId);
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'index.m3u8');
    const segmentPattern = path.join(outputDir, 'segment_%03d.ts');
    const r2Prefix = `videos/${lessonId}`;
    const hlsBaseUrl = `${R2_PUBLIC_URL}/${r2Prefix}/`;

    // ১. ওয়াচার চালু করুন যা প্রতিটি .ts তৈরি হওয়ার সাথে সাথে আপলোড করবে
    const watcher = this.r2UploadService.watchAndUpload(outputDir, r2Prefix);

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.FFMPEG_PATH, [
        '-y', '-i', path.resolve(videoPath),
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'hls',
        '-hls_time', '4', 
        '-hls_list_size', '0', 
        '-hls_base_url', hlsBaseUrl,
        '-hls_segment_filename', segmentPattern,
        playlistPath,
      ]);

      // 🔥 গুরুত্বপূর্ণ: ট্রান্সকোডিং শুরু হওয়ার ৫-১০ সেকেন্ড পর ইউআরএল পাঠিয়ে দিন
      // এতে প্লেয়ার সাথে সাথে ভিডিও শুরু করতে পারবে
      let isResolved = false;
      const checkInitialFiles = setInterval(async () => {
        if (fs.existsSync(playlistPath) && !isResolved) {
          try {
            const initialUrl = await this.r2UploadService.uploadPlaylist(playlistPath, `${r2Prefix}/index.m3u8`, r2Prefix);
            this.logger.log(`📡 Stream Started: ${initialUrl}`);
            isResolved = true;
            clearInterval(checkInitialFiles);
            resolve(initialUrl); // ফ্রন্টএন্ডে সাথে সাথে ইউআরএল চলে যাবে
          } catch (e) {
            this.logger.error("Waiting for initial segments...");
          }
        }
      }, 5000);

      ffmpeg.on('close', async (code) => {
        watcher.close();
        clearInterval(checkInitialFiles);
        if (code === 0) {
          this.logger.log(`✅ Full Video Transcoding Finished for ${lessonId}`);
          // ফাইনাল একবার প্লেলিস্ট আপলোড নিশ্চিত করা
          await this.r2UploadService.uploadPlaylist(playlistPath, `${r2Prefix}/index.m3u8`, r2Prefix);
        } else {
          if (!isResolved) reject(new Error('FFmpeg failed'));
        }
      });
    });
  }
}