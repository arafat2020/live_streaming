import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { UpdateModeratorDto } from './dto/update-moderator.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { BanType, AppealStatus } from '@prisma/client';
import { ModeratorBanUserDto } from './dto/moderator-ban-user.dto';
import { SubmitAppealDto } from './dto/submit-appeal.dto';
import { HandleAppealDto } from './dto/handle-appeal.dto';


@Injectable()
export class ModeratorService {
  constructor(private readonly prisma: PrismaService) { }


  async create(createModeratorDto: CreateModeratorDto, requesterId: string) {
    const { userId, channelId } = createModeratorDto;

    // 1. Check if requester is channel owner
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== requesterId) {
      throw new ForbiddenException('Only channel owners can assign moderators');
    }

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if moderator already exists
    const existingModerator = await this.prisma.moderator.findFirst({
      where: {
        userId,
        channelId,
      },
    });

    if (existingModerator) {
      throw new BadRequestException('User is already a moderator of this channel');
    }

    // Create moderator
    const moderator = await this.prisma.moderator.create({
      data: {
        userId,
        channelId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return {
      message: 'Moderator assigned successfully',
      data: moderator,
    };
  }

  async findAll() {
    const moderators = await this.prisma.moderator.findMany({
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      message: 'Moderators retrieved successfully',
      data: moderators,
      count: moderators.length,
    };
  }

  async findOne(id: string) {
    const moderator = await this.prisma.moderator.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!moderator) {
      throw new NotFoundException('Moderator not found');
    }

    return {
      message: 'Moderator retrieved successfully',
      data: moderator,
    };
  }

  async findByChannel(channelId: string) {
    const moderators = await this.prisma.moderator.findMany({
      where: { channelId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
            profileImage: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      message: 'Channel moderators retrieved successfully',
      data: moderators,
      count: moderators.length,
    };
  }

  async findByUser(userId: string) {
    const moderators = await this.prisma.moderator.findMany({
      where: { userId },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      message: 'User moderator assignments retrieved successfully',
      data: moderators,
      count: moderators.length,
    };
  }

  async update(id: string, updateModeratorDto: UpdateModeratorDto) {
    // Check if moderator exists
    const existingModerator = await this.prisma.moderator.findUnique({
      where: { id },
    });

    if (!existingModerator) {
      throw new NotFoundException('Moderator not found');
    }

    // If updating userId or channelId, check if they exist
    if (updateModeratorDto.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: updateModeratorDto.userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }
    }

    if (updateModeratorDto.channelId) {
      const channel = await this.prisma.channel.findUnique({
        where: { id: updateModeratorDto.channelId },
      });

      if (!channel) {
        throw new NotFoundException('Channel not found');
      }
    }

    // Update moderator
    const moderator = await this.prisma.moderator.update({
      where: { id },
      data: updateModeratorDto,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return {
      message: 'Moderator updated successfully',
      data: moderator,
    };
  }

  async remove(id: string, requesterId: string) {
    // Check if moderator exists
    const existingModerator = await this.prisma.moderator.findUnique({
      where: { id },
      include: { channel: true },
    });

    if (!existingModerator) {
      throw new NotFoundException('Moderator not found');
    }

    // Check if requester is channel owner
    if (existingModerator.channel.ownerId !== requesterId) {
      throw new ForbiddenException('Only channel owners can remove moderators');
    }

    // Remove moderator
    await this.prisma.moderator.delete({
      where: { id },
    });

    return {
      message: 'Moderator removed successfully',
    };
  }

  async removeByUserAndChannel(userId: string, channelId: string) {
    const moderator = await this.prisma.moderator.findFirst({
      where: {
        userId,
        channelId,
      },
    });

    if (!moderator) {
      throw new NotFoundException('Moderator assignment not found');
    }

    await this.prisma.moderator.delete({
      where: { id: moderator.id },
    });

    return {
      message: 'Moderator removed successfully',
    };
  }

  async checkIsModerator(userId: string, channelId: string): Promise<boolean> {
    // 1. Check if user is the channel owner
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { ownerId: true },
    });

    if (channel && channel.ownerId === userId) {
      return true;
    }

    // 2. Check if user is an assigned moderator
    const moderator = await this.prisma.moderator.findFirst({
      where: {
        userId,
        channelId,
      },
    });

    return !!moderator;
  }

  async banUser(channelId: string, dto: ModeratorBanUserDto, bannedBy: string) {

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.id === channel.ownerId) {
      throw new ForbiddenException('Cannot ban channel owner');
    }

    const existingBan = await this.prisma.banUser.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId: dto.userId,
        },
      },
    });

    if (existingBan) {
      return this.prisma.banUser.update({
        where: { id: existingBan.id },
        data: {
          banType: dto.banType,
          reason: dto.reason || null,
          bannedBy,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          updatedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              email: true,
              profileImage: true,
            },
          },
        },
      });
    }

    if (dto.banType === BanType.TEMPORARY && !dto.expiresAt) {
      throw new BadRequestException('Temporary ban requires expiresAt');
    }

    return this.prisma.banUser.create({
      data: {
        channelId,
        userId: dto.userId,
        banType: dto.banType,
        reason: dto.reason || null,
        bannedBy,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
            profileImage: true,
          },
        },
      },
    });
  }

  async unbanUser(channelId: string, userId: string, requesterId: string) {
    // 1. Verify requester is moderator or owner
    const isMod = await this.checkIsModerator(requesterId, channelId);
    if (!isMod) {
      throw new ForbiddenException('You do not have permission to moderate this channel');
    }

    const ban = await this.prisma.banUser.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
    });

    if (!ban) {
      throw new NotFoundException('Ban record not found');
    }

    await this.prisma.banUser.delete({
      where: { id: ban.id },
    });

    return {
      message: 'User unbanned successfully from this channel',
    };
  }

  async getBannedUsers(channelId: string, requesterId: string) {
    // 1. Verify requester is moderator or owner
    const isMod = await this.checkIsModerator(requesterId, channelId);
    if (!isMod) {
      throw new ForbiddenException('You do not have permission to moderate this channel');
    }

    const bannedUsers = await this.prisma.banUser.findMany({
      where: { channelId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
            profileImage: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Banned users retrieved successfully',
      data: bannedUsers,
      count: bannedUsers.length,
    };
  }

  async checkUserBan(channelId: string, userId: string) {
    const ban = await this.prisma.banUser.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
      select: {
        id: true,
        banType: true,
        expiresAt: true,
        reason: true,
      }
    });

    // No ban record
    if (!ban) {
      return {
        isBanned: false,
      };
    }

    // Temporary ban expired → treat as unbanned
    if (
      ban.banType === BanType.TEMPORARY &&
      ban.expiresAt &&
      ban.expiresAt < new Date()
    ) {
      return {
        isBanned: false,
      };
    }

    // Active ban
    return {
      isBanned: true,
      banType: ban.banType,
      expiresAt: ban.expiresAt,
      reason: ban.reason,
    };
  }

  async searchUsersForModeration(channelId: string, query: string, requesterId: string) {
    // 1. Verify requester is moderator or owner of the channel
    const isMod = await this.checkIsModerator(requesterId, channelId);
    if (!isMod) {
      throw new ForbiddenException('You do not have permission to moderate this channel');
    }

    // 2. Search users (efficient query)
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { firstName: { contains: query, mode: 'insensitive' as const } },
          { email: { contains: query, mode: 'insensitive' as const } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        email: true,
        profileImage: true,
        moderator: {
          where: { channelId },
          select: { id: true }
        },
        banUser: {
          where: { channelId },
          select: {
            id: true,
            banType: true,
            expiresAt: true,
            reason: true
          }
        },
      },
      take: 20,
    });

    return users.map(user => {
      const activeBan = user.banUser.find(ban => {
        if (ban.banType === BanType.PERMANENT) return true;
        return ban.expiresAt && ban.expiresAt > new Date();
      });

      return {
        id: user.id,
        firstName: user.firstName,
        email: user.email,
        profileImage: user.profileImage,
        isModerator: user.moderator.length > 0,
        isBanned: !!activeBan,
        banDetails: activeBan || null,
      };
    });
  }

  async submitAppeal(userId: string, dto: SubmitAppealDto) {
    const { channelId, reason } = dto;

    // 1. Check if user is actually banned
    const banStatus = await this.checkUserBan(channelId, userId);
    if (!banStatus.isBanned) {
      throw new BadRequestException('You are not banned from this channel');
    }

    // 2. Check if there is already a pending appeal
    const existingAppeal = await this.prisma.unbanAppeal.findFirst({
      where: {
        userId,
        channelId,
        status: AppealStatus.PENDING,
      },
    });

    if (existingAppeal) {
      throw new BadRequestException('You already have a pending appeal for this channel');
    }

    // 3. Create appeal
    return this.prisma.unbanAppeal.create({
      data: {
        userId,
        channelId,
        reason,
      },
    });
  }

  async getAppeals(channelId: string, requesterId: string) {
    // 1. Verify requester is moderator or owner
    const isMod = await this.checkIsModerator(requesterId, channelId);
    if (!isMod) {
      throw new ForbiddenException('You do not have permission to view appeals for this channel');
    }

    const appeals = await this.prisma.unbanAppeal.findMany({
      where: { channelId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            email: true,
            profileImage: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      message: 'Appeals retrieved successfully',
      data: appeals,
      count: appeals.length,
    };
  }

  async handleAppeal(appealId: string, dto: HandleAppealDto, requesterId: string) {
    const { status, moderatorNote } = dto;

    // 1. Find appeal
    const appeal = await this.prisma.unbanAppeal.findUnique({
      where: { id: appealId },
      include: { channel: true },
    });

    if (!appeal) {
      throw new NotFoundException('Appeal not found');
    }

    // 2. Verify requester is moderator or owner of the channel
    const isMod = await this.checkIsModerator(requesterId, appeal.channelId);
    if (!isMod) {
      throw new ForbiddenException('You do not have permission to handle appeals for this channel');
    }

    if (appeal.status !== AppealStatus.PENDING) {
      throw new BadRequestException('Appeal has already been handled');
    }

    // 3. Update appeal
    const updatedAppeal = await this.prisma.$transaction(async (tx) => {
      const appealResult = await tx.unbanAppeal.update({
        where: { id: appealId },
        data: {
          status,
          moderatorNote,
          handledBy: requesterId,
        },
      });

      // 4. If approved, unban the user
      if (status === AppealStatus.APPROVED) {
        await tx.banUser.deleteMany({
          where: {
            channelId: appeal.channelId,
            userId: appeal.userId,
          },
        });
      }

      return appealResult;
    });

    return {
      message: `Appeal ${status.toLowerCase()} successfully`,
      data: updatedAppeal,
    };
  }
}
