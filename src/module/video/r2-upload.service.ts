// import { Injectable, Logger } from '@nestjs/common';
// import { PutObjectCommand } from '@aws-sdk/client-s3';
// import { Upload } from '@aws-sdk/lib-storage';
// import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from '../../config/r2.config';
// import * as fs from 'fs';
// import * as path from 'path';

// @Injectable()
// export class R2UploadService {
//   private readonly logger = new Logger(R2UploadService.name);

//   async uploadFile(localPath: string, r2Key: string, contentType: string = 'application/octet-stream'): Promise<string> {
//     try {
//       const fileStream = fs.createReadStream(localPath);
//       const upload = new Upload({
//         client: r2Client,
//         params: {
//           Bucket: R2_BUCKET,
//           Key: r2Key,
//           Body: fileStream,
//           ContentType: contentType,
//         },
//       });
//       await upload.done();
//       return `${R2_PUBLIC_URL}/${r2Key}`;
//     } catch (error) {
//       this.logger.error(`❌ Upload failed for ${r2Key}:`, error);
//       throw error;
//     }
//   }

//   async uploadSegments(localDir: string, r2Prefix: string): Promise<string[]> {
//     const files = fs.readdirSync(localDir).filter((f) => f.endsWith('.ts'));
//     const uploadPromises = files.map((filename) => {
//       return this.uploadFile(path.join(localDir, filename), `${r2Prefix}/${filename}`, 'video/mp2t');
//     });
//     return Promise.all(uploadPromises);
//   }

//   async uploadPlaylist(localPlaylistPath: string, r2Key: string, r2Prefix: string): Promise<string> {
//     try {
//       let content = fs.readFileSync(localPlaylistPath, 'utf-8');

//       // 🚨 FIX: এখানে সব ভুল ডোমেইন ক্লিন করে দেওয়া হচ্ছে
//       content = content.replace(/https:\/\/rappio\.tv\.com/g, R2_PUBLIC_URL);
//       content = content.replace(/https:\/\/rappio\.tv/g, R2_PUBLIC_URL);

//       // যদি প্লেলিস্টে শুধু ফাইলের নাম থাকে, তবে তার আগে পাবলিক ইউআরএল বসাবে
//       if (!content.includes('http')) {
//         content = content.replace(/segment_(\d+)\.ts/g, `${R2_PUBLIC_URL}/${r2Prefix}/segment_$1.ts`);
//       }

//       await r2Client.send(new PutObjectCommand({
//         Bucket: R2_BUCKET,
//         Key: r2Key,
//         Body: content,
//         ContentType: 'application/vnd.apple.mpegurl',
//       }));

//       return `${R2_PUBLIC_URL}/${r2Key}`;
//     } catch (error) {
//       this.logger.error(`❌ Playlist upload failed:`, error);
//       throw error;
//     }
//   }

//   watchAndUpload(localDir: string, r2Prefix: string, onSegmentUploaded?: (url: string) => void): fs.FSWatcher {
//     return fs.watch(localDir, async (eventType, filename) => {
//       if (eventType === 'rename' && filename?.endsWith('.ts')) {
//         const localPath = path.join(localDir, filename);
//         await new Promise((resolve) => setTimeout(resolve, 200)); // Wait for file write
//         if (fs.existsSync(localPath)) {
//           const url = await this.uploadFile(localPath, `${r2Prefix}/${filename}`, 'video/mp2t');
//           if (onSegmentUploaded) onSegmentUploaded(url);
//         }
//       }
//     });
//   }
// }

import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from '../../config/r2.config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class R2UploadService {
  private readonly logger = new Logger(R2UploadService.name);

  async uploadFile(localPath: string, r2Key: string, contentType: string): Promise<string> {
    const fileStream = fs.createReadStream(localPath);
    const upload = new Upload({
      client: r2Client,
      params: { Bucket: R2_BUCKET, Key: r2Key, Body: fileStream, ContentType: contentType },
    });
    await upload.done();
    return `${R2_PUBLIC_URL}/${r2Key}`;
  }

  async uploadPlaylist(localPath: string, r2Key: string, r2Prefix: string): Promise<string> {
    let content = fs.readFileSync(localPath, 'utf-8');
    // ভুল ডোমেইন ক্লিনআপ
    content = content.replace(/https:\/\/rappio\.tv\.com/g, R2_PUBLIC_URL);
    content = content.replace(/https:\/\/rappio\.tv/g, R2_PUBLIC_URL);

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: content,
      ContentType: 'application/vnd.apple.mpegurl',
      CacheControl: 'no-cache', // প্লেয়ার যেন সবসময় নতুন ফাইল পায়
    }));
    return `${R2_PUBLIC_URL}/${r2Key}`;
  }

  watchAndUpload(localDir: string, r2Prefix: string) {
    const playlistPath = path.join(localDir, 'index.m3u8');
    const r2PlaylistKey = `${r2Prefix}/index.m3u8`;

    return fs.watch(localDir, async (eventType, filename) => {
      if (eventType === 'rename' && filename?.endsWith('.ts')) {
        const localPath = path.join(localDir, filename);
        
        // ফাইলটি ডিস্কে লেখা শেষ হওয়ার জন্য সামান্য সময় দিন
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (fs.existsSync(localPath)) {
          try {
            // ১. সেগমেন্ট আপলোড
            await this.uploadFile(localPath, `${r2Prefix}/${filename}`, 'video/mp2t');
            
            // ২. প্লেলিস্ট আপডেট (যাতে প্লেয়ার জানে নতুন সেগমেন্ট এসেছে)
            if (fs.existsSync(playlistPath)) {
              await this.uploadPlaylist(playlistPath, r2PlaylistKey, r2Prefix);
              this.logger.log(`🔄 Segment and Playlist updated: ${filename}`);
            }
          } catch (e) {
            this.logger.error(`Live sync error: ${e.message}`);
          }
        }
      }
    });
  }
}