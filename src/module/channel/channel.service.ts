import { Injectable,BadRequestException ,NotFoundException, ForbiddenException} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelService {
  constructor(private prisma: PrismaService) {}
  private generateStreamKey(): string {
    return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  }

  /**Creates a channel for a new CREATOR user.*/
  async createChannelForCreator(userId: string, name: string) {
    const existingChannel = await this.prisma.channel.findUnique({
      where: { ownerId: userId }
    });

    if (existingChannel) {
      throw new BadRequestException('User already owns a channel.');
    }

    // Auto-generate a handle and ensure uniqueness (simple example, would need retry logic in production)
    const initialHandle = name.toLowerCase().replace(/\s/g, '');

    return this.prisma.channel.create({
      data: {
        ownerId: userId,
        name,
        handle: initialHandle,
        streamKey: this.generateStreamKey(),
      },
    });
  }


  /**Retrieves channel profile and content for public view.*/
  // async getPublicChannel(handle: string) {
  //   const channel = await this.prisma.channel.findUnique({
  //     where: { handle },
  //     include: {
  //       content: {
  //         where: { status: 'AVAILABLE', contentType: { not: 'LIVE_STREAM' } }, // Only show VODs
  //         orderBy: { createdAt: 'desc' },
  //       },
  //       Following: { select: { followerId: true } }, // Get list of followers for count
  //     },
  //   });
  //
  //   if (!channel) {
  //     throw new NotFoundException(`Channel ${handle} not found.`);
  //   }
  //
  //   return {
  //     id: channel.id,
  //     name: channel.name,
  //     handle: channel.handle,
  //     description: channel.description,
  //     ownerId: channel.ownerId,
  //     contentCount: channel.content.length,
  //     followerCount: channel.follow.length,
  //     content: channel.content,
  //   };
  // }
  async getPublicChannel(handle: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { handle },
      include: {
        content: {
          where: { status: 'AVAILABLE', contentType: { not: 'LIVE_STREAM' } }, // Only show VODs
          orderBy: { createdAt: 'desc' },
        },
        // FIX: Changed 'Following' to 'follow' to match the schema field name
        follow: { select: { followerId: true } }, // Get list of followers for count
      },
    });

    if (!channel) {
      throw new NotFoundException(`Channel ${handle} not found.`);
    }

    return {
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      description: channel.description,
      ownerId: channel.ownerId,
      // FIX: The included relation 'content' is now correctly recognized
      contentCount: channel.content.length,
      // FIX: The included relation 'follow' is now correctly recognized
      followerCount: channel.follow.length,
      content: channel.content,
    };
  }
  /**Retrieves full private channel details for the owner/creator.*/
  async getPrivateChannel(userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
      include: { owner: { select: { email: true, firstName: true } } },
    });

    if (!channel) {
      throw new NotFoundException('Creator channel not found.');
    }

    return channel; // Includes the sensitive streamKey
  }

  /**Allows channel owner to update name, description, and handle (with rate limit).*/
  async updateChannel(userId: string, data: UpdateChannelDto) {
    const channel = await this.prisma.channel.findUnique({ where: { ownerId: userId } });
    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }

    // Logic for Handle Change Rate Limit (30 days)
    if (data.handle && data.handle !== channel.handle) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (channel.lastHandleUpdate > thirtyDaysAgo) {
        throw new BadRequestException('Handle can only be changed once every 30 days.');
      }
    }

    return this.prisma.channel.update({
      where: { ownerId: userId },
      data: {
        ...data,
        lastHandleUpdate: data.handle && data.handle !== channel.handle ? new Date() : channel.lastHandleUpdate,
      },
    });
  }

  /**Security critical: Generates a new stream key for the channel owner.*/
  // async rotateStreamKey(userId: string): Promise<{ streamKey: string }> {
  //   const newKey = this.generateStreamKey();
  //
  //   await this.prisma.channel.update({
  //     // where: { ownerId: userId },
  //     // data: { streamKey: newKey },
  //     where: { ownerId: userId }, // <-- This is the lookup criteria
  //     data: { streamKey: newKey },
  //   });
  //
  //   // Future: Log this security event
  //
  //   return { streamKey: newKey };
  // }
  async rotateStreamKey(userId: string): Promise<{ streamKey: string }> {
    // FIX: Select the channel ID and check for existence
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
      select: { id: true }
    });

    if (!channel) {
      // This exception should be hit if the channel record is missing
      throw new NotFoundException('Channel not found. Cannot rotate key without a channel record.');
    }

    const newKey = this.generateStreamKey();

    // FIX: Using the retrieved primary key (id) for the update
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { streamKey: newKey },
    });

    // Future: Log this security event

    return { streamKey: newKey };
  }
  /**Internal function used by the RTMP server to authenticate the stream.*/
  async validateStreamKey(key: string): Promise<boolean> {
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey: key },
      select: { owner: { select: { status: true } } },
    });

    // Key must exist AND the owner must be ACTIVE (not suspended)
    return !!channel && channel.owner.status === 'ACTIVE';
  }
  
async getChannels() {
  const channels = await this.prisma.channel.findMany({
    select: {
      id: true,
      name: true,
      handle: true,
      description: true,
      streamKey: true,

      owner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          status: true,
          profileImage: true,
        },
      },

      _count: {
        select: {
          content: true,
        },
      },

      createdAt: true,
      updatedAt: true,
    },
  });

  const views = await this.prisma.content.groupBy({
    by: ['channelId'],
    _sum: {
      views: true,
    },
  });

  const viewsMap = new Map(
    views.map(v => [v.channelId, v._sum.views ?? 0])
  );

  return channels.map(channel => ({
    ...channel,
    totalViews: viewsMap.get(channel.id) ?? 0,
  }));
}

async getChannelById(channelId: string) {
  const channel = await this.prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      name: true,
      handle: true,
      streamKey: true,
      description: true,
      owner: { select: { id: true, firstName: true, lastName: true, status: true } },
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!channel) {
    throw new NotFoundException('Channel not found.');
  }

  // Optional: ensure owner is ACTIVE
  if (channel.owner.status !== 'ACTIVE') {
    throw new ForbiddenException('Channel owner is not active.');
  }

  return channel;
}
async getContentByChannelId (channelId: string){
  const data = await this.prisma.content.findMany({where:{channelId:channelId}})
    if (!data) {
    throw new NotFoundException('Content not found.');
  }
  return data
}
}