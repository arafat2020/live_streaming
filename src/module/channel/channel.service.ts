import { Injectable,BadRequestException ,NotFoundException, ForbiddenException} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { BanType , Prisma} from '@prisma/client';
import { BanUserDto } from './dto/ban-user.dto';
import { GetChannelsDto } from './dto/get-channels-query.dto';

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
 // channel.service.ts
async getPrivateChannel(userId: string) {
  const channel = await this.prisma.channel.findUnique({
    where: { ownerId: userId },
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          profileImage: true,
        },
      },
      _count: {
        select: {
          content: true,     // Total content count
          follow: true,      // Total followers
        },
      },
    },
  });

  if (!channel) {
    throw new NotFoundException('Creator channel not found.');
  }

  //  Calculate total views (sum of all content views)
  const totalViews = await this.prisma.content.aggregate({
    where: {
      channelId: channel.id,
    },
    _sum: {
      views: true,
    },
  });

  //  Get additional statistics
  const liveContentCount = await this.prisma.content.count({
    where: {
      channelId: channel.id,
      contentType: 'LIVE_STREAM',
    },
  });

  const vodContentCount = await this.prisma.content.count({
    where: {
      channelId: channel.id,
      contentType: 'VOD',
    },
  });

  // Destructure _count and restructure response
  const { _count, ...channelData } = channel;

  return {
    ...channelData,
    statistics: {
      totalViews: totalViews._sum.views || 0,
      totalContent: _count.content,
      // totalFollowers: _count.follow,
      // liveStreamCount: liveContentCount,
      // vodCount: vodContentCount,
    },
  };
}

  /**Allows channel owner to update name, description, and handle (with rate limit).*/
  async updateChannel(userId: string, data: UpdateChannelDto) {
    const channel = await this.prisma.channel.findUnique({ where: { ownerId: userId } });
    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }
  const isOwner = channel.ownerId === userId;
    if (!isOwner) {
    throw new ForbiddenException('You are not authorized to updated this channel. Only the channel owner can updated channel.');
  }
    // // Logic for Handle Change Rate Limit (30 days)
    // if (data.handle && data.handle !== channel.handle) {
    //   const thirtyDaysAgo = new Date();
    //   thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    //   if (channel.lastHandleUpdate > thirtyDaysAgo) {
    //     throw new BadRequestException('Handle can only be changed once every 30 days.');
    //   }
    // }

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
  

async getChannels(dto: GetChannelsDto) {
  const { search, page = 1, limit = 10 } = dto;
  const skip = (page - 1) * limit;

  // Build where clause for search
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { handle: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  // Get total count for pagination
  const total = await this.prisma.channel.count({ where });

  // Fetch channels with pagination
  const channels = await this.prisma.channel.findMany({
    where,
    select: {
      id: true,
      name: true,
      handle: true,
      description: true,
      streamKey: true,
      logo: true,
      isLive: true,
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
    skip,
    take: limit,
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Get views for the channels
  const channelIds = channels.map(c => c.id);
  const views = await this.prisma.content.groupBy({
    by: ['channelId'],
    where: {
      channelId: { in: channelIds },
    },
    _sum: {
      views: true,
    },
  });

  const viewsMap = new Map(
    views.map(v => [v.channelId, v._sum.views ?? 0])
  );

  const data = channels.map(channel => ({
    ...channel,
    totalViews: viewsMap.get(channel.id) ?? 0,
  }));

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPreviousPage: page > 1,
    },
  };
}


async getChannelById(channelId: string) {
  // Get channel with all details and counts
  const channel = await this.prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          profileImage: true,
        },
      },
      _count: {
        select: {
          content: true,
          follow: true,
        },
      },
    },
  });

  if (!channel) {
    throw new NotFoundException('Channel not found.');
  }

  // Optional: ensure owner is ACTIVE
  if (channel.owner.status !== 'ACTIVE') {
    throw new ForbiddenException('Channel owner is not active.');
  }

  //  Calculate total views (sum of all content views)
  const totalViews = await this.prisma.content.aggregate({
    where: {
      channelId: channel.id,
    },
    _sum: {
      views: true,
    },
  });

  //  Get content breakdown by type
  const [liveStreamCount, vodCount] = await Promise.all([
    this.prisma.content.count({
      where: {
        channelId: channel.id,
        contentType: 'LIVE_STREAM',
      },
    }),
    this.prisma.content.count({
      where: {
        channelId: channel.id,
        contentType: 'VOD',
      },
    }),
  ]);

  // Destructure _count and restructure response
  const { _count, ...channelData } = channel;

  return {
    ...channelData,
    statistics: {
      totalViews: totalViews._sum.views || 0,
      totalContent: _count.content,
      // totalFollowers: _count.follow,
      // liveStreamCount,
      // vodCount,
    },
  };
}

async getContentByChannelId (channelId: string){
  const data = await this.prisma.content.findMany({where:{channelId:channelId}})
    if (!data) {
    throw new NotFoundException('Content not found.');
  }
  return data
}
  /**
   * Ban a user from a channel
   */
  async banUser(channelId: string, dto: BanUserDto, bannedBy: string) {
    // Verify channel exists
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { owner: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Cannot ban channel owner
    if (user.id === channel.ownerId) {
      throw new ForbiddenException('Cannot ban the channel owner');
    }

    // Check if user is already banned
    const existingBan = await this.prisma.channelBan.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId: dto.userId,
        },
      },
    });

    if (existingBan) {
      throw new ForbiddenException('User is already banned from this channel');
    }

    // Validate temporary ban has expiration
    if (dto.banType === BanType.TEMPORARY && !dto.expiresAt) {
      throw new ForbiddenException('Temporary bans must have an expiration date');
    }

    // Create ban
    const ban = await this.prisma.channelBan.create({
      data: {
        channelId,
        userId: dto.userId,
        reason: dto.reason,
        bannedBy,
        banType: dto.banType,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    return ban;
  }

  /**
   * Unban a user from a channel
   */
  async unbanUser(channelId: string, userId: string) {
    const ban = await this.prisma.channelBan.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
    });

    if (!ban) {
      throw new NotFoundException('Ban not found');
    }

    await this.prisma.channelBan.delete({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
    });

    return { message: 'User unbanned successfully' };
  }

  /**
   * Get all banned users for a channel
   */
  async getBannedUsers(channelId: string, page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;

    const [bans, total] = await this.prisma.$transaction([
      this.prisma.channelBan.findMany({
        where: { channelId },
        skip,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.channelBan.count({ where: { channelId } }),
    ]);

    return {
      data: bans,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Check if user is banned from channel
   */
  async isUserBanned(channelId: string, userId: string): Promise<boolean> {
    const ban = await this.prisma.channelBan.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
    });

    if (!ban) return false;

    // Check if temporary ban has expired
    if (ban.banType === BanType.TEMPORARY && ban.expiresAt) {
      if (new Date() > ban.expiresAt) {
        // Auto-remove expired ban
        await this.prisma.channelBan.delete({
          where: {
            channelId_userId: {
              channelId,
              userId,
            },
          },
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Clean up expired temporary bans (run via cron job)
   */
  async cleanExpiredBans() {
    const result = await this.prisma.channelBan.deleteMany({
      where: {
        banType: BanType.TEMPORARY,
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    return { deleted: result.count };
  }
 
 // Get recommended channels for a user
async getRecommendedChannels(userId: string, limit: number = 5) {
  // STEP 1: User which channel follow
  const follows = await this.prisma.follow.findMany({
    where: {
      followerId: userId,
    },
    select: {
      followingId: true,
    },
  });

  const followedChannelIds = follows.map(f => f.followingId);

  // STEP 2: Similar / Active channels
  const similarChannels = await this.prisma.channel.findMany({
    where: {
      id: {
        notIn: followedChannelIds,
      },
      content: {
        some: {
          status: 'AVAILABLE',
        },
      },
    },
    include: {
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
          follow: true,
          content: true,
        },
      },
    },
    take: 30,
  });

  // STEP 3: Popular channels (fallback)
  const popularChannels = await this.prisma.channel.findMany({
    where: {
      id: {
        notIn: followedChannelIds,
      },
    },
    include: {
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
          follow: true,
        },
      },
    },
    orderBy: {
      follow: {
        _count: 'desc',
      },
    },
    take: 30,
  });

  // STEP 4: Live channel boost
  const liveChannels = await this.prisma.channel.findMany({
    where: {
      isLive: true,
      id: {
        notIn: followedChannelIds,
      },
    },
    include: {
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
          follow: true,
          content: true,
        },
      },
    },
    take: 15,
  });

  // STEP 5: Merge + unique
  const channelMap = new Map<string, any>();

  [...similarChannels, ...popularChannels, ...liveChannels].forEach(channel => {
    if (!channelMap.has(channel.id)) {
      channelMap.set(channel.id, channel);
    }
  });

  // STEP 6: Score system
  const scoredChannels = Array.from(channelMap.values()).map(channel => {
    const score =
      (channel._count?.follow || 0) * 2 +
      (channel._count?.content || 0) +
      (channel.isLive ? 5 : 0);

    return {
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      logo: channel.logo,
      description: channel.description,
      isLive: channel.isLive,

      // ADDED OWNER HERE
      owner: channel.owner,

      followers: channel._count?.follow || 0,
      contents: channel._count?.content || 0,
      score,
    };
  });

  // STEP 7: Sort + limit
  scoredChannels.sort((a, b) => b.score - a.score);

  return scoredChannels.slice(0, limit);
}


}