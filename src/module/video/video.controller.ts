import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException, Body, UseGuards, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { VideoService } from './video.service';
import * as fs from 'fs';
import * as path from 'path';

import { CreateVideoDto } from './dto/create-video.dto';
import { ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TermsAcceptedGuard } from 'src/common/guards/terms-accepted.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';
import { VideoChunkService } from './video-chunk.service';

@Controller('video')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);
  constructor(
    private readonly videoService: VideoService,
    private readonly chunkService: VideoChunkService,
  ) { }
  // =====================================================
  // EXISTING ENDPOINT (Keep for backward compatibility)
  // =====================================================
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles(UserRole.CREATOR, UserRole.ADMIN)
  @Post('upload')
  @ApiOperation({ summary: 'Upload video and convert to HLS (Single upload)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // Reduce to 100MB for single upload
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateVideoDto,
  ) {
    if (!file) {
      throw new BadRequestException('File not found');
    }

    const lessonId = uuidv4();

    // Use SAME processLargeVideo method
    const { contentId, processingPromise } = await this.videoService.processLargeVideo(
      lessonId,
      dto,
      file.buffer,
    );

    // Handle processing completion in background
    processingPromise
      .then(async (result) => {
        this.logger.log(`✅ Processing complete for ${lessonId}. Updating content status...`);
        await this.videoService.updateContentAfterProcessing(contentId, result.playbackUrl, result.thumbnailUrl);
      })
      .catch((err) => {
        this.logger.error(`❌ Background processing failed for ${lessonId}: ${err.message}`);
      });

    return {
      success: true,
      message: 'Video upload complete. Processing started in background.',
      contentId,
      playlistUrl: null, // Not available yet
    };
  }

  // =====================================================
  // NEW CHUNKED UPLOAD ENDPOINTS
  // =====================================================
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles(UserRole.CREATOR, UserRole.ADMIN)
  @Post('upload/init')
  @ApiOperation({ summary: 'Initialize chunked video upload' })
  async initChunkedUpload(
    @Body('fileName') fileName: string,
    @Body('fileSize') fileSize: number,
    @Body('totalChunks') totalChunks: number,
    @Body('title') title: string,
    @Body('streamKey') streamKey: string,
    @Body('description') description?: string,
    @Body('category') category?: string,
  ) {
    // Log to debug
    this.logger.log(`📊 Received params:`);
    this.logger.log(`  fileName: ${fileName}`);
    this.logger.log(`  fileSize: ${fileSize}`);
    this.logger.log(`  totalChunks: ${totalChunks}`);
    this.logger.log(`  streamKey: ${streamKey}`);

    // Validation
    if (!fileName || fileName.trim() === '') {
      throw new BadRequestException('fileName is required');
    }
    if (!fileSize || fileSize <= 0) {
      throw new BadRequestException('fileSize is required and must be greater than 0');
    }
    if (!totalChunks || totalChunks <= 0) {
      throw new BadRequestException('totalChunks is required and must be greater than 0');
    }
    if (!streamKey || streamKey.trim() === '') {
      throw new BadRequestException('streamKey is required');
    }

    const uploadId = uuidv4();

    this.logger.log(`🚀 Initializing upload: ${uploadId}`);

    await this.chunkService.initializeSession({
      uploadId,
      fileName,
      fileSize,
      totalChunks,
      title: title || 'Untitled Video',
      description: description || '',
      category: category || undefined,
      streamKey,
    });

    return {
      success: true,
      uploadId,
      message: 'Upload session initialized',
    };
  }

  // Step 2: Upload chunk
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles(UserRole.CREATOR, UserRole.ADMIN)
  @Post('upload/chunk')
  @ApiOperation({ summary: 'Upload a single chunk' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('chunk', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body('uploadId') uploadId: string,
    @Body('chunkIndex') chunkIndex: string,
  ) {
    if (!file) {
      throw new BadRequestException('Chunk file not found');
    }

    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    if (chunkIndex === undefined) {
      throw new BadRequestException('chunkIndex is required');
    }

    this.logger.log(
      `📦 Chunk received: uploadId=${uploadId}, index=${chunkIndex}, size=${file.size}`,
    );

    const result = await this.chunkService.saveChunk(
      uploadId,
      parseInt(chunkIndex, 10),
      file.buffer,
    );

    return {
      success: true,
      uploadId,
      chunkIndex: parseInt(chunkIndex, 10),
      chunksReceived: result.chunksReceived,
      totalChunks: result.totalChunks,
    };
  }

  // Step 3: Complete
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles(UserRole.CREATOR, UserRole.ADMIN)
  @Post('upload/complete')
  @ApiOperation({ summary: 'Complete chunked upload and start processing' })
  async completeChunkedUpload(@Body('uploadId') uploadId: string) {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    this.logger.log(`🎬 Completing upload: ${uploadId}`);

    const lessonId = uuidv4();
    const tempOutputDir = path.resolve(process.cwd(), 'uploads', 'videos', lessonId);

    if (!fs.existsSync(tempOutputDir)) {
      fs.mkdirSync(tempOutputDir, { recursive: true });
    }

    const mergedFilePath = path.join(tempOutputDir, 'merged_input.mp4');

    const metadata = await this.chunkService.mergeChunksToFile(uploadId, mergedFilePath);

    this.logger.log(`🎥 Starting video processing: ${lessonId}`);

    // ✅ Start processing in background (Fire and Forget)
    const { contentId, processingPromise } = await this.videoService.processLargeVideo(
      lessonId,
      {
        title: metadata.title,
        description: metadata.description,
        category: metadata.category,
        streamKey: metadata.streamKey,
      },
      undefined, // No buffer
      mergedFilePath, // Pass file path
    );

    // Handle processing completion in background
    processingPromise
      .then(async (result) => {
        this.logger.log(`✅ Processing complete for ${lessonId}. Updating content status...`);
        // Update content to AVAILABLE with playback URL and thumbnail
        await this.videoService.updateContentAfterProcessing(contentId, result.playbackUrl, result.thumbnailUrl);
      })
      .catch((err) => {
        this.logger.error(`❌ Background processing failed for ${lessonId}: ${err.message}`);
      });

    await this.chunkService.cleanupSession(uploadId);

    this.logger.log(`✅ Upload complete. Processing started for content: ${contentId}`);

    return {
      success: true,
      message: 'Video upload complete. Processing started in background.',
      contentId,
      lessonId,
    };
  }

  // Cancel
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Post('upload/cancel')
  @ApiOperation({ summary: 'Cancel chunked upload' })
  async cancelChunkedUpload(@Body('uploadId') uploadId: string) {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    await this.chunkService.cleanupSession(uploadId);
    this.logger.log(`❌ Upload cancelled: ${uploadId}`);

    return { success: true, message: 'Upload cancelled' };
  }

}
