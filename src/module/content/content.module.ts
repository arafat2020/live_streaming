import { forwardRef, Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { WatchHistoryModule } from '../watch-history/watch-history.module';
import { AdminContentController } from './admin-content.controller';
import { StorageCleanupService } from './storage-cleanup.service';
import { VideoModule } from '../video/video.module';

@Module({
  imports: [WatchHistoryModule, forwardRef(() => VideoModule)],
  controllers: [ContentController, AdminContentController],
  providers: [ContentService, StorageCleanupService],
  exports: [ContentService]
})
export class ContentModule { }
