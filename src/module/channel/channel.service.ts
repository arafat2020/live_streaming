import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { BanType, UserRole, UserStatus } from '@prisma/client';
import { GetChannelsDto } from './dto/get-channels-query.dto';

@Injectable()
export class ChannelService {
  constructor(private prisma: PrismaService) { }
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

    // Get additional statistics
    await this.prisma.content.count({
      where: {
        channelId: channel.id,
        contentType: 'LIVE_STREAM',
      },
    });

    await this.prisma.content.count({
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
        totalFollowers: _count.follow,
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

    if (!channel) {
      return false;
    }

    return channel.owner.status === 'ACTIVE';
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
            username: true,
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
            username: true,
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
        content: {
          where: {
            contentType: 'LIVE_STREAM',
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            playbackUrl: true,
            createdAt: true,
            status: true,
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
    await Promise.all([
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

    // Destructure _count and content, then restructure response
    const { _count, content, ...channelData } = channel;

    const latestStream = content?.length > 0 ? content[0] : null;

    return {
      ...channelData,
      latestStream,
      statistics: {
        totalViews: totalViews._sum.views || 0,
        totalContent: _count.content,
        // totalFollowers: _count.follow,
        // liveStreamCount,
        // vodCount,
      },
    };
  }

  async getChannelByUsername(usernameOrHandle: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: usernameOrHandle },
      select: { id: true },
    });

    if (user) {
      const channel = await this.prisma.channel.findUnique({
        where: { ownerId: user.id },
        select: { id: true },
      });

      if (!channel) {
        throw new NotFoundException('Channel not found.');
      }

      return this.getChannelById(channel.id);
    }

    const channelByHandle = await this.prisma.channel.findUnique({
      where: { handle: usernameOrHandle },
      select: { id: true },
    });

    if (!channelByHandle) {
      throw new NotFoundException('Channel not found.');
    }

    return this.getChannelById(channelByHandle.id);
  }

  async getContentByChannelId(channelId: string, page: number = 1, limit: number = 10) {
    // Validate pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Max 100 items per page
    const skip = (validPage - 1) * validLimit;

    // Get total count
    const total = await this.prisma.content.count({
      where: { channelId: channelId },
    });

    if (total === 0) {
      throw new NotFoundException('Content not found.');
    }

    // Get paginated data
    const contents = await this.prisma.content.findMany({
      where: { channelId: channelId },
      skip: skip,
      take: validLimit,
      orderBy: { createdAt: 'desc' }, // Optional: order by creation date
    });

    return {
      contents,
      total,
      totalPages: Math.ceil(total / validLimit),
    };
  }

  /**
   * Check if user is banned from channel
   */
  async isUserBanned(channelId: string, userId: string): Promise<boolean> {
    const ban = await this.prisma.banUser.findUnique({
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
        await this.prisma.banUser.delete({
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
    const result = await this.prisma.banUser.deleteMany({
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
  async getRecommendedChannels(userId: string | null, limit: number = 5) {
    let followedChannelIds: string[] = [];

    // STEP 1: Get followed channels only if user is authenticated
    if (userId) {
      const follows = await this.prisma.follow.findMany({
        where: {
          followerId: userId,
        },
        select: {
          followingId: true,
        },
      });

      followedChannelIds = follows.map(f => f.followingId);
    }

    const exclusionFilter = {
      owner: {
        role: { not: UserRole.ADMIN },
        isBanned: false,
        isShadowBanned: false,
        status: UserStatus.ACTIVE,
      },
    };

    const notInFollowed = {
      id: {
        notIn: followedChannelIds.length > 0 ? followedChannelIds : undefined,
      },
    };

    // STEP 2: Similar / Active channels
    const similarChannels = await this.prisma.channel.findMany({
      where: {
        ...notInFollowed,
        ...exclusionFilter,
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
      take: 20,
    });

    // STEP 3: Popular channels (by followers)
    const popularChannels = await this.prisma.channel.findMany({
      where: {
        ...notInFollowed,
        ...exclusionFilter,
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
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
      orderBy: {
        follow: {
          _count: 'desc',
        },
      },
      take: 20,
    });

    // STEP 4: Live channel boost
    const liveChannels = await this.prisma.channel.findMany({
      where: {
        isLive: true,
        ...notInFollowed,
        ...exclusionFilter,
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
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

    // STEP 5: High-view channels
    const highViewContent = await this.prisma.content.groupBy({
      by: ['channelId'],
      where: {
        status: 'AVAILABLE',
        channelId: { not: null },
      },
      _sum: {
        views: true,
      },
      orderBy: {
        _sum: {
          views: 'desc',
        },
      },
      take: 30,
    });

    const highViewChannelIds = highViewContent
      .map(c => c.channelId)
      .filter((id): id is string => !!id && !followedChannelIds.includes(id));

    const highViewChannels = await this.prisma.channel.findMany({
      where: {
        id: { in: highViewChannelIds },
        ...exclusionFilter,
      },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
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
      take: 20,
    });

    // STEP 6: Merge + unique
    const channelMap = new Map<string, any>();

    [...similarChannels, ...popularChannels, ...liveChannels, ...highViewChannels].forEach(channel => {
      if (!channelMap.has(channel.id)) {
        channelMap.set(channel.id, channel);
      }
    });

    const allCandidateIds = Array.from(channelMap.keys());

    // STEP 7: Fetch total views for ALL candidates for accurate scoring
    const candidateViews = await this.prisma.content.groupBy({
      by: ['channelId'],
      where: {
        channelId: { in: allCandidateIds },
        status: 'AVAILABLE',
      },
      _sum: {
        views: true,
      },
    });

    const viewsMap = new Map<string, number>(candidateViews.map(v => [v.channelId as string, v._sum.views || 0]));

    // STEP 8: Score system
    const scoredChannels = Array.from(channelMap.values()).map(channel => {
      const channelData = channel as {
        id: string;
        name: string;
        handle: string;
        logo: string | null;
        description: string | null;
        isLive: boolean | null;
        owner: { id: string; firstName: string; status: string; profileImage: string | null };
        _count: { follow: number; content: number };
      };

      const totalViews = viewsMap.get(channelData.id) || 0;
      const followCount = channelData._count?.follow || 0;
      const contentCount = channelData._count?.content || 0;
      const isLive = channelData.isLive || false;

      const score =
        followCount * 2 +
        contentCount +
        (isLive ? 10 : 0) +
        Math.floor(totalViews / 50); // Every 50 views adds 1 point

      return {
        id: channelData.id,
        name: channelData.name,
        handle: channelData.handle,
        logo: channelData.logo,
        description: channelData.description,
        isLive: !!isLive,
        owner: channelData.owner,
        followers: followCount,
        contents: contentCount,
        totalViews,
        score,
      };
    });

    // STEP 9: Sort + limit
    scoredChannels.sort((a, b) => b.score - a.score);

    return scoredChannels.slice(0, limit);
  }


}