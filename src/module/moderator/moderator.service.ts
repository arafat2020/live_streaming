import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { UpdateModeratorDto } from './dto/update-moderator.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { BanType } from '@prisma/client';
import { BanUserDto } from './dto/ban-user.dto';


@Injectable()
export class ModeratorService {
    constructor(private readonly prisma: PrismaService) {}
    

  async create(createModeratorDto: CreateModeratorDto) {
    const { userId, channelId } = createModeratorDto;

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if channel exists
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
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
            lastName:true,
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

  async remove(id: string) {
    // Check if moderator exists
    const existingModerator = await this.prisma.moderator.findUnique({
      where: { id },
    });

    if (!existingModerator) {
      throw new NotFoundException('Moderator not found');
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
    console.log("hit checkIsModerator")
    const moderator = await this.prisma.moderator.findFirst({
      where: {
        userId,
        channelId,
      },
    });

    return !!moderator;
  }

async banUser(channelId: string, dto: BanUserDto, bannedBy: string) {

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
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        updatedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profileImage: true,
          },
        },
      },
    });
    //throw new ForbiddenException('User already banned');
  }

  if (dto.banType === BanType.TEMPORARY && !dto.expiresAt) {
    throw new BadRequestException('Temporary ban requires expiresAt');
  }

  return this.prisma.banUser.create({
    data: {
      channelId,
      userId: dto.userId,
      banType: dto.banType,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          profileImage: true,
        },
      },
    },
  });
}

async checkUserBan(channelId: string, userId: string) {
  console.log("hit check Ban User")
  const ban = await this.prisma.banUser.findUnique({
    where: {
      channelId_userId: {
        channelId,
        userId,
      },
    },
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
  };
}
}
