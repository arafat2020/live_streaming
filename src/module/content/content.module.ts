import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { WatchHistoryModule } from '../watch-history/watch-history.module';

@Module({
  imports: [WatchHistoryModule],
  controllers: [ContentController],
  providers: [ContentService],
  exports:[ContentService]
})
export class ContentModule {}
