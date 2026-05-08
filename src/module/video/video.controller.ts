import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import { memoryStorage } from 'multer';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VideoService } from './video.service';

import { ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TermsAcceptedGuard } from 'src/common/guards/terms-accepted.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateVideoDto } from './dto/create-video.dto';
import { MediaLiveService } from './media-live.service';
import { VideoChunkService } from './video-chunk.service';

@Controller('video')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);
  constructor(
    private readonly videoService: VideoService,
    private readonly chunkService: VideoChunkService,
    private readonly mediaLiveService: MediaLiveService,
  ) {}
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
    const { contentId, processingPromise } =
      await this.videoService.processLargeVideo(lessonId, dto, file.buffer);

    // Handle processing completion in background
    processingPromise
      .then(async (result) => {
        this.logger.log(
          `✅ MediaConvert job submitted for ${lessonId}. status will be updated via webhook.`,
        );
      })
      .catch((err) => {
        this.logger.error(
          `❌ Background processing failed for ${lessonId}: ${err.message}`,
        );
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
  @Roles(UserRole.USER, UserRole.CREATOR, UserRole.ADMIN)
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
    // Optional: log at debug level if needed
    // this.logger.debug(`📊 Received params: fileName=${fileName}, fileSize=${fileSize}, totalChunks=${totalChunks}, streamKey=${streamKey}`);

    // Validation
    if (!fileName || fileName.trim() === '') {
      throw new BadRequestException('fileName is required');
    }
    if (!fileSize || fileSize <= 0) {
      throw new BadRequestException(
        'fileSize is required and must be greater than 0',
      );
    }
    if (!totalChunks || totalChunks <= 0) {
      throw new BadRequestException(
        'totalChunks is required and must be greater than 0',
      );
    }
    if (!streamKey || streamKey.trim() === '') {
      throw new BadRequestException('streamKey is required');
    }

    const uploadId = uuidv4();

    // Optional: debug log for initialization
    // this.logger.debug(`🚀 Initializing upload: ${uploadId}`);

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
  @Roles(UserRole.USER, UserRole.CREATOR, UserRole.ADMIN)
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

    // Optional: debug chunk received
    // this.logger.debug(`📦 Chunk received: uploadId=${uploadId}, index=${chunkIndex}, size=${file.size}`);

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
  @Roles(UserRole.USER, UserRole.CREATOR, UserRole.ADMIN)
  @Post('upload/complete')
  @ApiOperation({ summary: 'Complete chunked upload and start processing' })
  async completeChunkedUpload(@Body('uploadId') uploadId: string) {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    const lessonId = uuidv4();
    const tempOutputDir = path.resolve(
      process.cwd(),
      'uploads',
      'videos',
      lessonId,
    );

    if (!fs.existsSync(tempOutputDir)) {
      fs.mkdirSync(tempOutputDir, { recursive: true });
    }

    const mergedFilePath = path.join(tempOutputDir, 'merged_input.mp4');

    const metadata = await this.chunkService.mergeChunksToFile(
      uploadId,
      mergedFilePath,
    );

    this.logger.log(`🎥 Starting video processing: ${lessonId}`);

    // ✅ Start processing in background (Fire and Forget)
    const { contentId, processingPromise } =
      await this.videoService.processLargeVideo(
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

    // Optional: debug processing start
    // this.logger.debug(`🎥 Processing started for ${lessonId}: ${contentId}`);

    // Handle processing completion in background
    processingPromise
      .then(async (result) => {
        this.logger.log(
          `✅ MediaConvert job submitted for ${lessonId}. status will be updated via webhook.`,
        );
      })
      .catch((err) => {
        this.logger.error(
          `❌ Background processing failed for ${lessonId}: ${err.message}`,
        );
        this.logger.error(`Full error:`, err.stack);
      });

    await this.chunkService.cleanupSession(uploadId);

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

  // =====================================================
  // DIAGNOSTIC ENDPOINTS (Admin Only)
  // =====================================================

  /**
   * 🔍 List all MediaLive inputs and channels
   * Helps identify the service limit problem (max 5 push inputs)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('medialive/diagnostics')
  @ApiOperation({ summary: '🔍 [ADMIN] Get MediaLive resource diagnostics' })
  async getMediaLiveDiagnostics() {
    try {
      this.logger.log('📋 Getting MediaLive diagnostics...');

      const channels = await this.mediaLiveService.listAllChannels();
      const orphanedCount = channels.channels.filter(
        (ch: any) => ch.state !== 'RUNNING' && ch.state !== 'CREATING',
      ).length;

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        summary: {
          totalChannels: channels.count,
          orphanedOrStuckChannels: orphanedCount,
          warningThreshold: 5,
        },
        channels: channels.channels,
      };
    } catch (error) {
      this.logger.error(`Diagnostics failed: ${(error as any).message}`);
      throw error;
    }
  }

  /**
   * 🧹 Clean up orphaned resources for a specific content
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('medialive/cleanup/:contentId')
  @ApiOperation({ summary: '🧹 [ADMIN] Clean up orphaned MediaLive resources' })
  async cleanupOrphanedResources(@Param('contentId') contentId: string) {
    try {
      this.logger.log(`🧹 Cleaning up resources for content: ${contentId}`);

      const result =
        await this.mediaLiveService.cleanupOrphanedResourcesForContent(
          contentId,
        );

      return {
        status: 'ok',
        message: 'Cleanup completed',
        deletedCount: result.deletedCount,
        contentId,
      };
    } catch (error) {
      this.logger.error(`Cleanup failed: ${(error as any).message}`);
      throw error;
    }
  }

  /**
   * 🗑️ Force delete a specific input (DANGEROUS!)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('medialive/force-delete-input/:inputId')
  @ApiOperation({
    summary: '🗑️ [ADMIN] Force delete orphaned input (DANGEROUS!)',
  })
  async forceDeleteInput(@Param('inputId') inputId: string) {
    try {
      this.logger.warn(`⚠️ FORCE DELETING input: ${inputId}`);

      await this.mediaLiveService.forceDeleteInput(inputId);

      return {
        status: 'ok',
        message: 'Input force deleted',
        inputId,
      };
    } catch (error) {
      this.logger.error(`Force delete failed: ${(error as any).message}`);
      throw error;
    }
  }

  /**
   * 🗑️ Force delete a specific channel (DANGEROUS!)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('medialive/force-delete-channel/:channelId')
  @ApiOperation({
    summary: '🗑️ [ADMIN] Force delete orphaned channel (DANGEROUS!)',
  })
  async forceDeleteChannel(@Param('channelId') channelId: string) {
    try {
      this.logger.warn(`⚠️ FORCE DELETING channel: ${channelId}`);

      await this.mediaLiveService.forceDeleteChannel(channelId);

      return {
        status: 'ok',
        message: 'Channel force deleted',
        channelId,
      };
    } catch (error) {
      this.logger.error(`Force delete failed: ${(error as any).message}`);
      throw error;
    }
  }
}
