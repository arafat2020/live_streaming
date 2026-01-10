import { Module } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { ChannelController } from './channel.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChannelManagementController } from './channel-management.controller';
import { VideoModule } from '../video/video.module';

@Module({
  imports: [PrismaModule, VideoModule],
  providers: [ChannelService],
  controllers: [ChannelController, ChannelManagementController],
  exports: [ChannelService],
})
export class ChannelModule { }
