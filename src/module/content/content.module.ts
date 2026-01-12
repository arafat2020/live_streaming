import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { WatchHistoryModule } from '../watch-history/watch-history.module';
import { AdminContentController } from './admin-content.controller';

@Module({
  imports: [WatchHistoryModule],
  controllers: [ContentController, AdminContentController],
  providers: [ContentService],
  exports: [ContentService]
})
export class ContentModule { }
