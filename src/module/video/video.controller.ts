import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VideoService } from './video.service';

// Temporary storage for uploaded files (will be deleted after processing)
const storage = diskStorage({
  destination: 'uploads/temp',
  filename: (_, file, cb) => {
    cb(null, `video-${uuidv4()}${path.extname(file.originalname)}`);
  },
});

@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage }))
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const videoId = uuidv4();

    // Start transcoding and uploading to R2
    // This returns the R2 playlist URL
    const playlistUrl = await this.videoService.transcodeVideoToHLS(
      file.path,
      videoId,
    );

    return {
      message: 'Video uploaded and processing',
      videoId,
      playlistUrl, // This will be the R2 URL
    };
  }
}