import { Module } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { R2UploadService } from './r2-upload.service';

@Module({
  controllers: [VideoController],
  providers: [VideoService,R2UploadService],
})
export class VideoModule {}
