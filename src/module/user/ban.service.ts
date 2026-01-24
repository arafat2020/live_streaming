import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BanUserDto } from './dto/ban-user.dto';
import { BanType } from '@prisma/client';
import { safeUserSelect } from './dto/safeUserSelect';

@Injectable()
export class BanService {
  constructor(private prisma: PrismaService) {}

  async banUser(userId: string, adminId: string, dto: BanUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let expiresAt: Date | null = null;
    if (dto.banType === BanType.TEMPORARY) {
      if (dto.expiresAt) {
        // Use the provided expiresAt date
        expiresAt = new Date(dto.expiresAt);
      } else if (dto.durationInDays) {
        // Calculate expiresAt from durationInDays
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + dto.durationInDays);
      } else {
        throw new BadRequestException(
          'Either durationInDays or expiresAt is required for temporary bans',
        );
      }
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

  async getBannedUsers(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const where = { isBanned: true };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...safeUserSelect,
          banExpiresAt: true,
          banReason: true,
          channel: true,
          platformBanLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async searchUsers(query?: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const where = query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' as const } },
            { firstName: { contains: query, mode: 'insensitive' as const } },
            { lastName: { contains: query, mode: 'insensitive' as const } },
            { id: { equals: query } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...safeUserSelect,
          isBanned: true,
          banExpiresAt: true,
          channel: true,
        },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete user and all related data (cascading deletes should be handled by Prisma schema)
    return await this.prisma.user.delete({
      where: { id: userId },
    });
  }
}
