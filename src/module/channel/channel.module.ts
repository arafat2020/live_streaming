import { Module } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { ChannelController } from './channel.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChannelManagementController } from './channel-management.controller';
import { VideoModule } from '../video/video.module';

import { WatchHistoryModule } from '../watch-history/watch-history.module';

@Module({
  imports: [PrismaModule, VideoModule, WatchHistoryModule],
  providers: [ChannelService],
  controllers: [ChannelController, ChannelManagementController],
  exports: [ChannelService],
})
export class ChannelModule {}
