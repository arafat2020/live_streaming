import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from '../../config/r2.config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class R2UploadService {
  private readonly logger = new Logger(R2UploadService.name);

  /**
   * Upload a single file to R2
   */
  async uploadFile(
    localPath: string,
    r2Key: string,
    contentType: string,
  ): Promise<string> {
    try {
      if (!fs.existsSync(localPath)) {
        throw new Error(`File not found: ${localPath}`);
      }

      const upload = new Upload({
        client: r2Client,
        params: {
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: fs.createReadStream(localPath),
          ContentType: contentType,
        },
      });

      await upload.done();
      
      const url = `${R2_PUBLIC_URL}/${r2Key}`;
      this.logger.debug(`✅ Uploaded: ${r2Key}`);
      
      return url;
    } catch (error) {
      this.logger.error(`Failed to upload ${r2Key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload playlist file to R2
   */
  async uploadPlaylist(localPath: string, r2Key: string): Promise<string | null> {
    try {
      if (!fs.existsSync(localPath)) {
        this.logger.warn(`Playlist not found: ${localPath}`);
        return null;
      }

      const content = fs.readFileSync(localPath, 'utf-8');

      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: content,
          ContentType: 'application/vnd.apple.mpegurl',
          CacheControl: 'no-cache',
        }),
      );

      this.logger.debug(`✅ Uploaded playlist: ${r2Key}`);
      
      return `${R2_PUBLIC_URL}/${r2Key}`;
    } catch (error) {
      this.logger.error(`Failed to upload playlist: ${error.message}`);
      throw error;
    }
  }

  /**
   * Watch directory and automatically upload new segments
   * Returns a controller object with stop() method
   */
  watchAndUpload(localDir: string, r2Prefix: string): { stop: () => void } {
    const uploaded = new Set<string>();
    const playlistPath = path.join(localDir, 'index.m3u8');

    this.logger.log(`👀 Watching: ${localDir} → ${r2Prefix}`);

    const interval = setInterval(async () => {
      try {
        if (!fs.existsSync(localDir)) {
          this.logger.warn(`Directory disappeared: ${localDir}`);
          return;
        }

        const files = fs
          .readdirSync(localDir)
          .filter((f) => f.endsWith('.ts'));

        for (const file of files) {
          if (uploaded.has(file)) continue;

          const localPath = path.join(localDir, file);
          
          // Wait for file to be fully written
          await this.waitForFileReady(localPath);

          if (!fs.existsSync(localPath)) continue;

          // Upload segment
          await this.uploadFile(
            localPath,
            `${r2Prefix}/${file}`,
            'video/mp2t',
          );

          uploaded.add(file);

          // Upload updated playlist
          if (fs.existsSync(playlistPath)) {
            await this.uploadPlaylist(
              playlistPath,
              `${r2Prefix}/index.m3u8`,
            );
          }

          this.logger.log(`📤 ${r2Prefix}/${file} uploaded`);
        }
      } catch (err) {
        this.logger.warn(`Watcher error: ${err.message}`);
      }
    }, 1000);

    return {
      stop: () => {
        clearInterval(interval);
        this.logger.log(`⏹️ Stopped watching: ${localDir}`);
      },
    };
  }

  /**
   * Wait for file to be fully written to disk
   */
  private async waitForFileReady(filePath: string, timeout = 3000): Promise<void> {
    const start = Date.now();
    let lastSize = -1;

    while (Date.now() - start < timeout) {
      try {
        const stats = fs.statSync(filePath);
        const currentSize = stats.size;

        if (currentSize > 0 && currentSize === lastSize) {
          // File size stable, it's ready
          return;
        }

        lastSize = currentSize;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch {
        // File doesn't exist yet
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}