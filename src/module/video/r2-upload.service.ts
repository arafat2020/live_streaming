import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { R2_BUCKET, R2_PUBLIC_URL, r2Client } from '../../config/r2.config';

@Injectable()
export class R2UploadService {
  private readonly logger = new Logger(R2UploadService.name);

  private listFilesRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listFilesRecursive(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Upload a single file to R2 (no retries for live streams to prevent crashes)
   */
  async uploadFile(
    localPath: string,
    r2Key: string,
    contentType: string,
  ): Promise<string | null> {
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
          CacheControl: 'public, max-age=31536000, immutable',
        },
      });

      await upload.done();

      const url = `${R2_PUBLIC_URL}/${r2Key}`;
      this.logger.debug(`✅ Uploaded: ${r2Key}`);
      return url;
    } catch (error) {
      // Log but don't throw for live streams to prevent crashes
      this.logger.error(`Failed to upload ${r2Key}: ${error.message}`);
      return null;
    }
  }

  /**
   * Upload playlist file to R2 (no retries for live streams to prevent crashes)
   */
  async uploadPlaylist(
    localPath: string,
    r2Key: string,
  ): Promise<string | null> {
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
          CacheControl: 'no-cache, no-store, must-revalidate',
        }),
      );

      this.logger.debug(`✅ Uploaded playlist: ${r2Key}`);
      return `${R2_PUBLIC_URL}/${r2Key}`;
    } catch (error) {
      // Log but don't throw for live streams to prevent crashes
      this.logger.error(`Failed to upload playlist: ${error.message}`);
      return null;
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

    const getR2KeyFromLocalPath = (localPath: string) => {
      const relative = path.relative(localDir, localPath).replace(/\\/g, '/');
      return `${r2Prefix}/${relative}`;
    };

    this.logger.log(`👀 Watching: ${localDir} → ${r2Prefix}`);

    const lastPlaylistUpload = new Map<string, number>();

    const interval = setInterval(async () => {
      try {
        if (!fs.existsSync(localDir)) {
          this.logger.warn(`Directory disappeared: ${localDir}`);
          return;
        }

        const allFiles = this.listFilesRecursive(localDir);
        const tsFiles = allFiles.filter((f) => f.endsWith('.ts'));
        const m3u8Files = allFiles.filter((f) => f.endsWith('.m3u8'));

        const segmentUploadPromises = tsFiles
          .filter(
            (filePath) => !uploaded.has(filePath) && !uploading.has(filePath),
          )
          .map(async (filePath) => {
            uploading.add(filePath);

            try {
              await this.waitForFileReady(filePath, 1000);
              if (!fs.existsSync(filePath)) {
                uploading.delete(filePath);
                return;
              }

              const r2Key = getR2KeyFromLocalPath(filePath);
              const result = await this.uploadFile(
                filePath,
                r2Key,
                'video/mp2t',
              );
              if (!result) {
                this.logger.warn(`Skipped upload due to failure: ${r2Key}`);
                uploading.delete(filePath);
                return;
              }

              uploaded.add(filePath);
              uploading.delete(filePath);

              this.logger.log(`📤 ${R2_PUBLIC_URL}/${r2Key} uploaded`);

              try {
                const shouldPreserveForThumbnail =
                  path.basename(filePath) === '000.ts';
                if (!shouldPreserveForThumbnail) {
                  fs.unlinkSync(filePath);
                }
              } catch (delErr) {
                this.logger.warn(
                  `Failed to delete ${filePath}: ${delErr.message}`,
                );
              }
            } catch (err) {
              uploading.delete(filePath);
              this.logger.error(`Failed to upload ${filePath}: ${err.message}`);
            }
          });

        await Promise.all(segmentUploadPromises);

        for (const playlistFilePath of m3u8Files) {
          try {
            // Throttle playlist uploads to every 2 seconds unless it's the master
            const now = Date.now();
            const lastUpload = lastPlaylistUpload.get(playlistFilePath) || 0;
            const isMaster = path.basename(playlistFilePath) === 'master.m3u8';

            if (now - lastUpload < 2000) {
              continue;
            }

            const r2Key = getR2KeyFromLocalPath(playlistFilePath);
            const result = await this.uploadPlaylist(playlistFilePath, r2Key);
            if (!result) {
              this.logger.warn(
                `Skipped playlist upload due to failure: ${r2Key}`,
              );
              continue;
            }
            lastPlaylistUpload.set(playlistFilePath, now);

            if (isMaster) {
              this.logger.log(`✅ Master Playlist Uploaded: ${r2Key}`);
            }
          } catch (err) {
            this.logger.warn(
              `Failed to upload playlist ${playlistFilePath}: ${err.message}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(`Watcher error: ${err.message}`);
      }
    }, 300);

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
  private async waitForFileReady(
    filePath: string,
    timeout = 1000,
  ): Promise<void> {
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
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        // File doesn't exist yet
        await new Promise((resolve) => setTimeout(resolve, 50));
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
  ): Promise<string | null> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.uploadFile(localPath, r2Key, contentType);
        if (result) return result;
        throw new Error('Upload returned null');
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Upload attempt ${attempt}/${maxRetries} failed for ${r2Key}: ${error.message}`,
          lastError,
        );

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
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
        new DeleteObjectCommand({
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
   * Delete all objects with a specific prefix (folder cleanup)
   */
  async deletePrefix(prefix: string): Promise<void> {
    try {
      this.logger.log(`🗑️ Deleting all objects with prefix: ${prefix}`);

      // List all objects with the prefix
      const listCommand = new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
      });

      const listResponse = await r2Client.send(listCommand);

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        this.logger.log(`ℹ️ No objects found with prefix: ${prefix}`);
        return;
      }

      // Prepare batch delete
      const deleteParams = {
        Bucket: R2_BUCKET,
        Delete: {
          Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key })),
        },
      };

      await r2Client.send(new DeleteObjectsCommand(deleteParams));
      this.logger.log(
        `✅ Deleted ${listResponse.Contents.length} objects with prefix: ${prefix}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to delete prefix ${prefix}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Check if a file exists in R2
   */
  async fileExists(r2Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
      });

      await r2Client.send(command);
      return true;
    } catch (error) {
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404
      ) {
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
