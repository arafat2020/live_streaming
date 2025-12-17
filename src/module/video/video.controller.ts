import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { VideoService } from './video.service';

@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/temp',
      filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
    }),
  }))
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    
    const lessonId = uuidv4();
    const playlistUrl = await this.videoService.transcodeVideoToHLS(file.path, lessonId);

    return {
      success: true,
      playlistUrl, // ফ্রন্টএন্ড এই লিঙ্কটি প্লেয়ারে চালাবে
    };
  }
}