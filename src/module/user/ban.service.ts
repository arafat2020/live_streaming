import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BanUserDto } from './dto/ban-user.dto';
import { BanType } from '@prisma/client';
import { safeUserSelect } from './dto/safeUserSelect';

@Injectable()
export class BanService {
    constructor(private prisma: PrismaService) { }

    async banUser(userId: string, adminId: string, dto: BanUserDto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        let expiresAt: Date | null = null;
        if (dto.banType === BanType.TEMPORARY) {
            if (!dto.durationInDays) {
                throw new BadRequestException('Duration is required for temporary bans');
            }
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + dto.durationInDays);
        }

        return await this.prisma.$transaction(async (tx) => {
            // 1. Update User
            await tx.user.update({
                where: { id: userId },
                data: {
                    isBanned: true,
                    banExpiresAt: expiresAt,
                    banReason: dto.reason || null,
                },
            });

            // 2. Create Log entry
            return await tx.platformBanLog.create({
                data: {
                    userId,
                    adminId,
                    banType: dto.banType,
                    reason: dto.reason,
                    expiresAt,
                },
            });
        });
    }

    async unbanUser(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        return await this.prisma.user.update({
            where: { id: userId },
            data: {
                isBanned: false,
                banExpiresAt: null,
                banReason: null,
            },
        });
    }

    async getBannedUsers() {
        return await this.prisma.user.findMany({
            where: { isBanned: true },
            select: {
                ...safeUserSelect,
                banExpiresAt: true,
                banReason: true,
                platformBanLogs: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
        });
    }

    async searchUsers(query: string) {
        return await this.prisma.user.findMany({
            where: {
                OR: [
                    { email: { contains: query, mode: 'insensitive' } },
                    { firstName: { contains: query, mode: 'insensitive' } },
                    { lastName: { contains: query, mode: 'insensitive' } },
                    { id: { equals: query } },
                ],
            },
            select: {
                ...safeUserSelect,
                isBanned: true,
                banExpiresAt: true,
            },
            take: 20,
        });
    }
}
