import { Injectable ,NotFoundException,BadRequestException} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FollowService {
  constructor(private prisma: PrismaService) {}

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

async getFollowedChannels(userId: string) {
  const follows = await this.prisma.follow.findMany({
    where: {
      followerId: userId,
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
              lastName: true,
              status: true,
              profileImage: true,
            },
          },
        },
      },
    },
  });

  // 🔹 Optional: flatten response for frontend
  return follows.map((item) => ({
    followedAt: item.createdAt,
    channel: {
      ...item.following,
    },
    owner: item.following.owner,
  }));
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
