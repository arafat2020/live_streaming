import { forwardRef, Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { LiveCommentModule } from '../live-comment/live-comment.module';
import { InternalController } from './internal.controller';
import { MediaConvertService } from './media-convert.service';
import { MediaLiveService } from './media-live.service';
import { MediaServerService } from './media-server.service';
import { R2UploadService } from './r2-upload.service';
import { ThumbnailService } from './thumbnail.service';
import { VideoChunkService } from './video-chunk.service';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [forwardRef(() => ContentModule), LiveCommentModule],
  controllers: [VideoController, InternalController],
  providers: [
    VideoService,
    R2UploadService,
    MediaServerService,
    MediaLiveService,
    MediaConvertService,
    VideoChunkService,
    ThumbnailService,
  ],
  exports: [
    VideoService,
    R2UploadService,
    ThumbnailService,
    MediaServerService,
    MediaLiveService,
    MediaConvertService,
  ],
})
export class VideoModule {}
