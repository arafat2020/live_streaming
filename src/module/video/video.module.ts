import { forwardRef, Module } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { InternalController } from './internal.controller';
import { R2UploadService } from './r2-upload.service';
import { ContentModule } from '../content/content.module';
import { MediaServerService } from './media-server.service';
import { MediaLiveService } from './media-live.service';
import { MediaConvertService } from './media-convert.service';
import { LiveCommentModule } from '../live-comment/live-comment.module';
import { VideoChunkService } from './video-chunk.service';
import { ThumbnailService } from './thumbnail.service';

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
