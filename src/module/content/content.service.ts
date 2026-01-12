import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryContentDto, ContentSortBy } from './dto/query-content.dto';
import { WatchHistoryService } from '../watch-history/watch-history.service';

@Injectable()
export class ContentService {
  constructor(private prisma: PrismaService,
    private readonly watchHistoryService: WatchHistoryService
  ) { }

  async create(dto: CreateContentDto) {
    const content = await this.prisma.content.create({
      data: {
        title: dto.title,
        description: dto.description,
        contentType: dto.contentType,
        status: dto.status ?? 'PROCESSING',
        durationSeconds: dto.durationSeconds,
        playbackUrl: dto.playbackUrl,
        thumbnailUrl: dto.thumbnailUrl,
        isPremium: dto.isPremium ?? false,
        // r2ObjectKey এর বদলে r2Prefix ব্যবহার করুন (Align with Schema)
        r2Prefix: dto.r2Prefix,
        channel: { connect: { id: dto.channelId } },
      },
    });

    return content;
  }

  async findAll(query: QueryContentDto, userId?: string) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy;
    const title = query.title;

    const skip = (page - 1) * pageSize;

    // Determine sorting
    const orderBy = sortBy === ContentSortBy.MOST_VIEWED
      ? { views: 'desc' as const }
      : { createdAt: 'desc' as const };

    // Build where clause
    const where: any = {};

    // Title search filter
    if (title) {
      where.title = {
        contains: title,
        mode: 'insensitive' as const,
      };
    }

    // Status filter
    // Status filter: Default to showing ready content (AVAILABLE or ENDED)
    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { in: ['AVAILABLE', 'ENDED'] as any };
    }

    //  EXCLUDE content from channels where user is banned
    if (userId) {
      // Get all channel IDs where user is banned
      const bannedChannels = await this.prisma.banUser.findMany({
        where: { userId },
        select: { channelId: true },
      });

      const bannedChannelIds = bannedChannels.map(ban => ban.channelId);

      // If user is banned from any channels, exclude their content
      if (bannedChannelIds.length > 0) {
        where.channelId = {
          notIn: bannedChannelIds, // Exclude these channels
        };
      }
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          channel: {
            select: {
              id: true,
              name: true,
              handle: true,
              logo: true,
              isLive: true,
              owner: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.content.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        ...(sortBy && { sortBy }),
        ...(title && { title }),
        ...(query.status && { status: query.status }),
      },
    };
  }
  async liveOnRappioList() {
    // ENDED   AVAILABLE
    const content = await this.prisma.content.findMany({
      where: { status: "AVAILABLE", contentType: "LIVE_STREAM" },
      include: {
        channel: {
          include: {
            owner: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
          },
        },
      },
    });

    if (!content) throw new NotFoundException('Content not found');
    return content;
  }


  async findOne(id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: {
        channel: true,
        watchHistory: { orderBy: { createdAt: 'desc' }, take: 50 }, // example
      },
    });

    if (!content) throw new NotFoundException('Content not found');
    await this.watchHistoryService.incrementViews(content?.id)
    return content;
  }

  async update(id: string, dto: UpdateContentDto) {
    // ensure content exists
    if (!id) {
      throw new BadRequestException('ID is required');
    }
    const isExists = await this.prisma.content.findUnique({
      where: { id }
    });
    if (!isExists) {
      throw new NotFoundException(`Content with ID ${id} not found`);
    }
    const data: any = { ...dto };
    if ((dto).channelId) {
      data.channel = { connect: { id: (dto as any).channelId } };
      delete data.channelId;
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data,
    });

    return updated;
  }


  async remove(id: string, userId: string, userRole?: string) {
    // Find the content with channel owner info
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            ownerId: true,
            name: true,
          },
        },
      },
    });

    // Check if content exists
    if (!content) {
      throw new NotFoundException('Content not found');
    }

    // Check if content has a channel
    if (!content.channel) {
      throw new BadRequestException('Content has no associated channel');
    }
    const isOwner = content.channel.ownerId === userId;
    const isAdmin = userRole === 'ADMIN';
    // VERIFY: Only channel owner can delete
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You are not authorized to delete this content. Only the channel owner can delete content.');
    }

    // Delete the content
    await this.prisma.content.delete({ where: { id } });

    return {
      success: true,
      message: 'Content deleted successfully',
    };
  }
  async adminFindAll(query: QueryContentDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy;
    const title = query.title;
    const status = query.status;

    const skip = (page - 1) * pageSize;

    const orderBy = sortBy === ContentSortBy.MOST_VIEWED
      ? { views: 'desc' as const }
      : { createdAt: 'desc' as const };

    const where: any = {};

    if (title) {
      where.title = {
        contains: title,
        mode: 'insensitive' as const,
      };
    }

    if (status) {
      where.status = status;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          channel: {
            select: {
              id: true,
              name: true,
              handle: true,
              owner: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.content.count({ where }),
    ]);

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

  async toggleVisibility(id: string, isHidden: boolean) {
    const content = await this.prisma.content.findUnique({ where: { id } });
    if (!content) throw new NotFoundException('Content not found');

    const newStatus = isHidden ? 'PRIVATE' : 'AVAILABLE';

    return this.prisma.content.update({
      where: { id },
      data: { status: newStatus as any },
    });
  }

  async forceEndStream(id: string) {
    const content = await this.prisma.content.findUnique({ where: { id } });
    if (!content) throw new NotFoundException('Content not found');

    if (content.contentType !== 'LIVE_STREAM') {
      throw new BadRequestException('Content is not a live stream');
    }

    return this.prisma.content.update({
      where: { id },
      data: { status: 'ENDED' as any },
    });
  }

  // optional: increment view count safely
  async incrementViews(id: string) {
    // Find the content with channel owner info
    const content = await this.prisma.content.findUnique({
      where: { id },
    });

    // Check if content exists
    if (!content) {
      throw new NotFoundException('Content not found');
    }
    const updated = await this.prisma.content.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { id: true, views: true },
    });
    return updated;
  }
}
