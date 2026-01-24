import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface UploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  title?: string;
  description?: string;
  category?: string;
  streamKey: string;
  createdAt: Date;
  chunks: number[];
}

@Injectable()
export class VideoChunkService {
  private readonly logger = new Logger(VideoChunkService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads', 'chunks');

  constructor() {
    // Create upload directory if doesn't exist
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  // Initialize upload session
  async initializeSession(
    data: Omit<UploadSession, 'createdAt' | 'chunks'>,
  ): Promise<void> {
    const sessionDir = path.join(this.uploadDir, data.uploadId);

    // Create session directory
    fs.mkdirSync(sessionDir, { recursive: true });

    // Save metadata
    const metadata: UploadSession = {
      ...data,
      createdAt: new Date(),
      chunks: [],
    };

    fs.writeFileSync(
      path.join(sessionDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
    );

    this.logger.log(`📦 Upload session initialized: ${data.uploadId}`);
  }

  // Save individual chunk WITH IDEMPOTENCY
  async saveChunk(
    uploadId: string,
    chunkIndex: number,
    buffer: Buffer,
  ): Promise<{ chunksReceived: number; totalChunks: number }> {
    try {
      this.logger.log(
        `💾 Saving chunk ${chunkIndex} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`,
      );

      const sessionDir = path.join(this.uploadDir, uploadId);
      const metadataPath = path.join(sessionDir, 'metadata.json');

      if (!fs.existsSync(metadataPath)) {
        this.logger.error(`❌ Session not found: ${uploadId}`);
        throw new BadRequestException('Upload session not found');
      }

      const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);

      // ✅ IDEMPOTENCY CHECK: Skip if chunk already exists
      if (fs.existsSync(chunkPath)) {
        this.logger.warn(
          `⚠️ Chunk ${chunkIndex} already exists, skipping (idempotent request)`,
        );

        // Still return current progress
        const metadata: UploadSession = JSON.parse(
          fs.readFileSync(metadataPath, 'utf8'),
        );

        return {
          chunksReceived: metadata.chunks.length,
          totalChunks: metadata.totalChunks,
        };
      }

      // Save chunk
      fs.writeFileSync(chunkPath, buffer);

      // Update metadata
      const metadata: UploadSession = JSON.parse(
        fs.readFileSync(metadataPath, 'utf8'),
      );

      if (!metadata.chunks.includes(chunkIndex)) {
        metadata.chunks.push(chunkIndex);
      }

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      this.logger.log(
        `✅ Chunk ${chunkIndex} saved. Progress: ${metadata.chunks.length}/${metadata.totalChunks}`,
      );

      return {
        chunksReceived: metadata.chunks.length,
        totalChunks: metadata.totalChunks,
      };
    } catch (error) {
      this.logger.error(`❌ Save chunk failed: ${error.message}`);
      this.logger.error(`  Upload ID: ${uploadId}, Chunk: ${chunkIndex}`);
      throw error;
    }
  }

  // Merge all chunks into single file (Memory Efficient)
  async mergeChunksToFile(
    uploadId: string,
    targetFilePath: string,
  ): Promise<UploadSession> {
    this.logger.log(
      `🔍 Starting merge for uploadId: ${uploadId} into ${targetFilePath}`,
    );

    const sessionDir = path.join(this.uploadDir, uploadId);
    const metadataPath = path.join(sessionDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      throw new BadRequestException('Upload session not found');
    }

    const metadata: UploadSession = JSON.parse(
      fs.readFileSync(metadataPath, 'utf8'),
    );

    if (metadata.chunks.length !== metadata.totalChunks) {
      throw new BadRequestException(
        `Missing chunks. Received ${metadata.chunks.length}/${metadata.totalChunks}`,
      );
    }

    // Ensure target directory exists
    const targetDir = path.dirname(targetFilePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Create/Clear target file
    if (fs.existsSync(targetFilePath)) {
      fs.unlinkSync(targetFilePath);
    }

    // Sort chunks
    const sortedChunks = [...metadata.chunks].sort((a, b) => a - b);

    // Merge chunks using streams for memory efficiency
    const writeStream = fs.createWriteStream(targetFilePath);

    for (const chunkIndex of sortedChunks) {
      const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);

      if (!fs.existsSync(chunkPath)) {
        writeStream.end();
        throw new BadRequestException(`Chunk ${chunkIndex} not found`);
      }

      const chunkBuffer = fs.readFileSync(chunkPath);
      writeStream.write(chunkBuffer);
    }

    await new Promise((resolve) => {
      writeStream.end(resolve);
    });

    this.logger.log(`✅ Merge complete: ${targetFilePath}`);
    return metadata;
  }

  // Cleanup session (with retry logic)
  async cleanupSession(uploadId: string): Promise<void> {
    const sessionDir = path.join(this.uploadDir, uploadId);

    if (fs.existsSync(sessionDir)) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        fs.rmSync(sessionDir, { recursive: true, force: true });
        this.logger.log(`🗑️ Cleaned up session: ${uploadId}`);
      } catch (error) {
        this.logger.error(
          `Failed to cleanup session ${uploadId}: ${error.message}`,
        );
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          fs.rmSync(sessionDir, { recursive: true, force: true });
          this.logger.log(`🗑️ Cleaned up session (retry): ${uploadId}`);
        } catch (retryError) {
          this.logger.error(
            `Failed to cleanup after retry: ${retryError.message}`,
          );
        }
      }
    }
  }

  // Get upload status
  async getUploadStatus(uploadId: string): Promise<{
    exists: boolean;
    chunksReceived?: number;
    totalChunks?: number;
    progress?: number;
  }> {
    const sessionDir = path.join(this.uploadDir, uploadId);
    const metadataPath = path.join(sessionDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return { exists: false };
    }

    const metadata: UploadSession = JSON.parse(
      fs.readFileSync(metadataPath, 'utf8'),
    );

    return {
      exists: true,
      chunksReceived: metadata.chunks.length,
      totalChunks: metadata.totalChunks,
      progress: Math.round(
        (metadata.chunks.length / metadata.totalChunks) * 100,
      ),
    };
  }

  // Cleanup old sessions
  async cleanupOldSessions(maxAgeHours: number = 24): Promise<void> {
    const sessions = fs.readdirSync(this.uploadDir);
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    for (const sessionId of sessions) {
      const sessionDir = path.join(this.uploadDir, sessionId);
      const metadataPath = path.join(sessionDir, 'metadata.json');

      if (fs.existsSync(metadataPath)) {
        const metadata: UploadSession = JSON.parse(
          fs.readFileSync(metadataPath, 'utf8'),
        );

        const age = now - new Date(metadata.createdAt).getTime();

        if (age > maxAge) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          this.logger.log(`🗑️ Cleaned up old session: ${sessionId}`);
        }
      }
    }
  }
}
