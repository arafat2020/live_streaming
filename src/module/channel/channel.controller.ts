import {
  Controller,
  ForbiddenException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ChannelService } from './channel.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from 'src/prisma/prisma.service';


@Controller('channels/:channelId')
@UseGuards(JwtAuthGuard)
export class ChannelController {
  constructor(private readonly channelService: ChannelService, private prisma: PrismaService) { }

  // Basic channel management endpoints can be added here
  // Moderation has been moved to ModeratorController

  private async verifyChannelOwner(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel || channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can moderate');
    }
  }
}