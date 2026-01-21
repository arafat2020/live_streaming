import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryFollowDto } from './dto/query-follow.dto';
import { WatchHistoryService } from '../watch-history/watch-history.service';

@Injectable()
export class FollowService {
  constructor(
    private prisma: PrismaService,
    private watchHistoryService: WatchHistoryService,
  ) { }

  async followChannel(userId: string, channnelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channnelId },
    });

    if (!channel) throw new NotFoundException('Channel not found');

    if (channel?.ownerId === userId) {
      throw new BadRequestException('You cannot follow your own channel');
    }

    // Check if already following
    const exists = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId: channel.id,
        },
      },
    });

    if (exists) {
      throw new BadRequestException('Already following this channel');
    }

    await this.prisma.follow.create({
      data: {
        followerId: userId,
        followingId: channel.id,
      },
    });

    return { message: 'Followed successfully' };
  }
  async unfollowChannel(userId: string, channnelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channnelId },
    });

    if (!channel) throw new NotFoundException('Channel not found');

    return this.prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId: channel.id,
        },
      },
    });
  }

  async isFollowing(userId: string, channnelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channnelId },
    });

    if (!channel) throw new NotFoundException('Channel not found');

    const follow = await this.prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId: channel.id,
        },
      },
    });

    return { isFollowing: !!follow };
  }

  // follow.service.ts
  async getFollowedChannels(userId: string, query?: QueryFollowDto) {
    const page = Math.max(query?.page ?? 1, 1);
    const pageSize = Math.min(query?.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    // Get followed channels with pagination and total count
    const [follows, total] = await this.prisma.$transaction([
      // Get paginated data
      this.prisma.follow.findMany({
        where: {
          followerId: userId,
        },
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc', // Most recently followed first
        },
        select: {
          createdAt: true,
          following: {
            select: {
              id: true,
              name: true,
              handle: true,
              logo: true,
              description: true,
              isLive: true,
              createdAt: true,
              updatedAt: true,

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
                },
              },

              // Get latest active live stream to get category and contentId (for viewers)
              content: {
                where: {
                  contentType: 'LIVE_STREAM',
                  status: 'AVAILABLE',
                },
                orderBy: {
                  createdAt: 'desc',
                },
                take: 1,
                select: {
                  id: true,
                  category: true,
                },
              },
            },
          },
        },
      }),

      // Get total count
      this.prisma.follow.count({
        where: {
          followerId: userId,
        },
      }),
    ]);

    // Flatten and restructure response
    const data = await Promise.all(follows.map((item: any) => {
      const { _count, content, ...channelData } = item.following;
      const liveStream = content && content.length > 0 ? content[0] : null;
      
      let currentViewers = 0;
      if (channelData.isLive && liveStream) {
        currentViewers = this.watchHistoryService.getActiveViewerCount(liveStream.id);
      }

      return {
        followedAt: item.createdAt,
        channel: {
          ...channelData,
          followerCount: _count?.follow || 0,
          category: liveStream?.category || null,
          currentViewers,
        },
        owner: item.following.owner,
      };
    }));

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }


  async getFollowers(channnelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channnelId },
    });

    if (!channel) throw new NotFoundException('Channel not found');

    return this.prisma.follow.findMany({
      where: { followingId: channel.id },
      include: { follower: true },
    });
  }

  async getFollowerCount(channelId: string) {
    // Validate channel existence
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    // Count followers
    const count = await this.prisma.follow.count({
      where: { followingId: channelId },
    });

    return { followers: count };
  }
}
