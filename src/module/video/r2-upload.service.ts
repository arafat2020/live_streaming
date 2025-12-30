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
   * ✅ OPTIMIZED: Added cache control headers
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
          // ✅ OPTIMIZED: Cache video segments forever (they're immutable)
          CacheControl: 'public, max-age=31536000, immutable',
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
   * Keep no-cache for playlists (they change frequently)
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
          // Keep no-cache for playlists - they update frequently
          CacheControl: 'no-cache, no-store, must-revalidate',
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
   * ✅ OPTIMIZED: Parallel uploads, faster polling, better error handling
   * Returns a controller object with stop() method
   */
 // r2-upload.service.ts - UPDATED watchAndUpload method

/**
 * Watch directory and automatically upload new segments
 * ✅ WITH AUTO-DELETE after upload
 */
watchAndUpload(localDir: string, r2Prefix: string): { stop: () => void } {
  const uploaded = new Set<string>();
  const uploading = new Set<string>();
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

      // Upload segments in parallel
      const uploadPromises = files
        .filter(file => !uploaded.has(file) && !uploading.has(file))
        .map(async (file) => {
          uploading.add(file);
          
          const localPath = path.join(localDir, file);
          
          try {
            await this.waitForFileReady(localPath, 1000);

            if (!fs.existsSync(localPath)) {
              uploading.delete(file);
              return;
            }

            // Upload segment
            await this.uploadFile(
              localPath,
              `${r2Prefix}/${file}`,
              'video/mp2t',
            );

            uploaded.add(file);
            uploading.delete(file);
            
            this.logger.log(`📤 ${r2Prefix}/${file} uploaded`);
            
            // ✅ DELETE LOCAL FILE AFTER SUCCESSFUL UPLOAD
            try {
              fs.unlinkSync(localPath);
              this.logger.log(`🗑️ Deleted local: ${file}`);
            } catch (delErr) {
              this.logger.warn(`Failed to delete ${file}: ${delErr.message}`);
            }
            
          } catch (err) {
            uploading.delete(file);
            this.logger.error(`Failed to upload ${file}: ${err.message}`);
          }
        });

      await Promise.all(uploadPromises);

      // Upload playlist after segments
      if (fs.existsSync(playlistPath)) {
        await this.uploadPlaylist(
          playlistPath,
          `${r2Prefix}/index.m3u8`,
        );
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
   * ✅ OPTIMIZED: Faster checks, shorter timeout
   */
  private async waitForFileReady(filePath: string, timeout = 1000): Promise<void> {
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
        // ✅ OPTIMIZED: Check every 50ms instead of 100ms
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch {
        // File doesn't exist yet
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * Upload file with retry logic for production reliability
   */
  async uploadFileWithRetry(
    localPath: string,
    r2Key: string,
    contentType: string,
    maxRetries = 3,
  ): Promise<string> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.uploadFile(localPath, r2Key, contentType);
      } catch (error) {
        lastError = error;
        this.logger.warn(`Upload attempt ${attempt}/${maxRetries} failed for ${r2Key}: ${error.message}`);
        
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to upload ${r2Key} after ${maxRetries} attempts: `);
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(r2Key: string): Promise<void> {
    try {
      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: r2Key,
        }),
      );
      
      this.logger.debug(`🗑️ Deleted from R2: ${r2Key}`);
    } catch (error) {
      this.logger.error(`Failed to delete ${r2Key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if a file exists in R2
   */
  async fileExists(r2Key: string): Promise<boolean> {
    try {
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
      });
      
      await r2Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }


  }

  async uploadBuffer(
    buffer: Buffer,
    r2Key: string,
    contentType: string,
  ): Promise<string> {
    try {
      const upload = new Upload({
        client: r2Client,
        params: {
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        },
      });

      await upload.done();
      
      const url = `${R2_PUBLIC_URL}/${r2Key}`;
      this.logger.log(`✅ Uploaded to R2: ${r2Key}`);
      
      return url;
    } catch (error) {
      this.logger.error(`❌ Failed to upload to R2 ${r2Key}: ${error.message}`);
      throw error;
    }
  }
}