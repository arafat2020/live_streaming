import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Res,
  Logger,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VideoService } from './video.service';

const storage = diskStorage({
  destination: 'uploads',
  filename: (_, file, cb) => {
    cb(null, `video-${uuidv4()}${path.extname(file.originalname)}`);
  },
});

@Controller('video')
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(private readonly videoService: VideoService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage }))
   uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    if (!file) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({ message: 'No file uploaded' });
    }

    const videoId = uuidv4();

    // Start transcoding in background (non-blocking)
    this.videoService.transcodeVideoToHLS(file.path, videoId);

    // Return playlist URL immediately
    return res.status(HttpStatus.OK).json({
      message: 'Video is being transcoded to HLS',
      videoId,
      playlistUrl: `http://localhost:${process.env.PORT}/uploads/videos/${videoId}/index.m3u8`,
    });
  }


}
