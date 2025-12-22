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
    content = content.replace(/https:\/\/rappio\.tv(\.com)?/g, R2_PUBLIC_URL);

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: content,
      ContentType: 'application/vnd.apple.mpegurl',
      CacheControl: 'no-cache',
    }));

    return `${R2_PUBLIC_URL}/${r2Key}`;
  }

  watchAndUpload(localDir: string, r2Prefix: string) {
    const playlistPath = path.join(localDir, 'index.m3u8');
    const r2PlaylistKey = `${r2Prefix}/index.m3u8`;

    // Reliable polling
    const uploaded = new Set<string>();
    const interval = setInterval(async () => {
      const files = fs.readdirSync(localDir).filter(f => f.endsWith('.ts'));
      for (const file of files) {
        if (uploaded.has(file)) continue;
        const localPath = path.join(localDir, file);
        if (!fs.existsSync(localPath)) continue;

        try {
          await this.uploadFile(localPath, `${r2Prefix}/${file}`, 'video/mp2t');
          uploaded.add(file);

          if (fs.existsSync(playlistPath)) {
            await this.uploadPlaylist(playlistPath, r2PlaylistKey, r2Prefix);
            this.logger.log(`🔄 Segment and Playlist updated: ${file}`);
          }
        } catch (e) {
          this.logger.error(`Upload failed: ${e.message}`);
        }
      }
    }, 1000);

    return { stop: () => clearInterval(interval) };
  }
}
