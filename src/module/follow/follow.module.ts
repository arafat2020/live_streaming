import { Module } from '@nestjs/common';
import { FollowService } from './follow.service';
import { FollowController } from './follow.controller';

import { WatchHistoryModule } from '../watch-history/watch-history.module';

@Module({
  imports: [WatchHistoryModule],
  controllers: [FollowController],
  providers: [FollowService],
})
export class FollowModule {}
