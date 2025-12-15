import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
// import { r2Client,R2_BUCKET, R2_PUBLIC_URL R2_BUCKET, R2_PUBLIC_URL } from '../config/r2.config';
import {r2Client,R2_BUCKET, R2_PUBLIC_URL} from '../../config/r2.config';
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
    contentType: string = 'application/octet-stream',
  ): Promise<string> {
    try {
      const fileStream = fs.createReadStream(localPath);
      const fileStats = fs.statSync(localPath);

      this.logger.log(`📤 Uploading ${r2Key} (${fileStats.size} bytes)`);

      const upload = new Upload({
        client: r2Client,
        params: {
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: fileStream,
          ContentType: contentType,
        },
      });

      await upload.done();

      const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;
      this.logger.log(`✅ Uploaded: ${publicUrl}`);

      return publicUrl;
    } catch (error) {
      this.logger.error(`❌ Upload failed for ${r2Key}:`, error);
      throw error;
    }
  }

  /**
   * Upload multiple files (segments) concurrently
   */
  async uploadSegments(
    localDir: string,
    r2Prefix: string,
    pattern: RegExp = /\.ts$/,
  ): Promise<string[]> {
    const files = fs.readdirSync(localDir).filter((f) => pattern.test(f));

    this.logger.log(`📦 Uploading ${files.length} segments...`);

    const uploadPromises = files.map((filename) => {
      const localPath = path.join(localDir, filename);
      const r2Key = `${r2Prefix}/${filename}`;
      const contentType = filename.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : 'video/mp2t';

      return this.uploadFile(localPath, r2Key, contentType);
    });

    return Promise.all(uploadPromises);
  }

  /**
   * Upload playlist and update segment URLs
   */
  async uploadPlaylist(
    localPlaylistPath: string,
    r2Key: string,
    r2Prefix: string,
  ): Promise<string> {
    try {
      // Read and modify playlist to use R2 URLs
      let playlistContent = fs.readFileSync(localPlaylistPath, 'utf-8');

      // Replace local segment paths with R2 URLs
      playlistContent = playlistContent.replace(
        /segment_(\d+)\.ts/g,
        `${R2_PUBLIC_URL}/${r2Prefix}/segment_$1.ts`,
      );

      this.logger.log(`📋 Uploading playlist: ${r2Key}`);

      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: playlistContent,
          ContentType: 'application/vnd.apple.mpegurl',
        }),
      );

      const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;
      this.logger.log(`✅ Playlist uploaded: ${publicUrl}`);

      return publicUrl;
    } catch (error) {
      this.logger.error(`❌ Playlist upload failed:`, error);
      throw error;
    }
  }

  /**
   * Watch directory and upload segments as they're created
   */
  watchAndUpload(
    localDir: string,
    r2Prefix: string,
    onSegmentUploaded?: (url: string) => void,
  ): fs.FSWatcher {
    this.logger.log(`👀 Watching directory: ${localDir}`);

    const watcher = fs.watch(localDir, async (eventType, filename) => {
      if (eventType === 'rename' && filename && filename.endsWith('.ts')) {
        const localPath = path.join(localDir, filename);

        // Wait a bit to ensure file is fully written
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (fs.existsSync(localPath)) {
          try {
            const r2Key = `${r2Prefix}/${filename}`;
            const url = await this.uploadFile(localPath, r2Key, 'video/mp2t');

            if (onSegmentUploaded) {
              onSegmentUploaded(url);
            }
          } catch (error) {
            this.logger.error(`Failed to upload segment ${filename}:`, error);
          }
        }
      }
    });

    return watcher;
  }
}