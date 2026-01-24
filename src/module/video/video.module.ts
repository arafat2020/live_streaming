import { forwardRef, Module } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { R2UploadService } from './r2-upload.service';
import { ContentModule } from '../content/content.module';
import { MediaServerService } from './media-server.service';
import { LiveCommentModule } from '../live-comment/live-comment.module';
import { VideoChunkService } from './video-chunk.service';
import { ThumbnailService } from './thumbnail.service';

@Module({
  imports: [forwardRef(() => ContentModule), LiveCommentModule],
  controllers: [VideoController],
  providers: [
    VideoService,
    R2UploadService,
    MediaServerService,
    VideoChunkService,
    ThumbnailService,
  ],
  exports: [
    VideoService,
    R2UploadService,
    ThumbnailService,
    MediaServerService,
  ],
})
export class VideoModule {}
