import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalContent,
      totalViews,
      newUsersToday,
      newContentToday,
      recentUsers,
      recentContent,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.content.count(),
      this.prisma.content.aggregate({
        _sum: {
          views: true,
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: {
            gte: today,
          },
        },
      }),
      this.prisma.content.count({
        where: {
          createdAt: {
            gte: today,
          },
        },
      }),
      this.prisma.user.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          profileImage: true,
          createdAt: true,
        },
      }),
      this.prisma.content.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          channel: {
            select: {
              name: true,
              handle: true,
            },
          },
        },
      }),
    ]);

    return {
      overview: {
        totalUsers,
        totalContent,
        totalViews: totalViews._sum.views || 0,
        newUsersToday,
        newContentToday,
      },
      recentUsers,
      recentContent,
    };
  }

  async getStorageStats() {
    const storageByChannel = await this.prisma.content.groupBy({
      by: ['channelId'],
      _sum: {
        fileSize: true,
      },
      orderBy: {
        _sum: {
          fileSize: 'desc',
        },
      },
      take: 10,
    } as any);

    const channels = await this.prisma.channel.findMany({
      where: {
        id: {
          in: storageByChannel
            .map((s) => s.channelId)
            .filter((id): id is string => id !== null),
        },
      },
      select: {
        id: true,
        name: true,
        handle: true,
      },
    });

    const totalStorage = await this.prisma.content.aggregate({
      _sum: {
        fileSize: true,
      },
    } as any);

    // Use any to bypass stale Prisma types if necessary, ensuring safety with optional chaining
    const totalSum = (totalStorage as any)._sum;
    const totalStorageBytes = totalSum?.fileSize
      ? Number(totalSum.fileSize)
      : 0;

    return {
      totalStorageBytes,
      topChannels: storageByChannel.map((s: any) => ({
        ...channels.find((c) => c.id === s.channelId),
        storageBytes: s._sum?.fileSize ? Number(s._sum.fileSize) : 0,
      })),
    };
  }
}
