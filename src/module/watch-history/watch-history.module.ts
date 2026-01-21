import { forwardRef, Module } from '@nestjs/common';
import { WatchHistoryService } from './watch-history.service';
import { WatchHistoryController } from './watch-history.controller';
import { LiveCommentModule } from '../live-comment/live-comment.module';

@Module({
  imports: [forwardRef(() => LiveCommentModule)],
  controllers: [WatchHistoryController],
  providers: [WatchHistoryService],
  exports: [WatchHistoryService],
})
export class WatchHistoryModule {}
