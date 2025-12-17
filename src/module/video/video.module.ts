import { Module } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { R2UploadService } from './r2-upload.service';
import {ContentModule} from '../content/content.module'
import { MediaServerService } from './media-server.service';
@Module({
  imports:[ContentModule],
  controllers: [VideoController],
  providers: [VideoService,R2UploadService,MediaServerService],
})
export class VideoModule {}
