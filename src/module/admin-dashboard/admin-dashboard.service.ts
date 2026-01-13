import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentStatus, UserStatus } from '@prisma/client';

@Injectable()
export class AdminDashboardService {
    constructor(private prisma: PrismaService) { }

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
        });

        const channels = await this.prisma.channel.findMany({
            where: {
                id: {
                    in: storageByChannel.map((s) => s.channelId).filter((id): id is string => id !== null),
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
        });

        return {
            totalStorageBytes: totalStorage._sum.fileSize || 0,
            topChannels: storageByChannel.map((s) => ({
                ...channels.find((c) => c.id === s.channelId),
                storageBytes: s._sum.fileSize || 0,
            })),
        };
    }
}
