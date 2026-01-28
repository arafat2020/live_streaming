import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { safeChannelSelect } from '../channel/dto/safeChannelSelect';
import { publicUserSelect } from '../user/dto/publicUserSelect';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { CreateContentDto } from './dto/create-content.dto';
import { ContentSortBy, QueryContentDto } from './dto/query-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';

@Injectable()
export class ContentService {
  constructor(
    private prisma: PrismaService,
    private readonly watchHistoryService: WatchHistoryService,
  ) {}

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
        category: dto.category,
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
    const orderBy =
      sortBy === ContentSortBy.MOST_VIEWED
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

    // Category filter
    if (query.category) {
      where.category = query.category;
    }

    // Status filter
    // Status filter: Default to showing ready content (AVAILABLE or ENDED)
    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { in: ['AVAILABLE', 'ENDED'] as any };
    }

    // Shadow-ban filter: Exclude if content is shadow-banned OR channel owner is shadow-banned
    // Exception: Owner and Admin can see it
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      const isAdmin = user?.role === 'ADMIN';

      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            {
              isShadowBanned: false,
              channel: { owner: { isShadowBanned: false } },
            },
            { channel: { ownerId: userId } },
            ...(isAdmin
              ? [
                  {
                    OR: [
                      { isShadowBanned: true },
                      { channel: { owner: { isShadowBanned: true } } },
                    ],
                  },
                ]
              : []),
          ],
        },
      ];
    } else {
      // Anonymous user: only non-shadow-banned content
      where.isShadowBanned = false;
      where.channel = { owner: { isShadowBanned: false } };
    }

    //  EXCLUDE content from channels where user is banned
    if (userId) {
      // Get all channel IDs where user is banned
      const bannedChannels = await this.prisma.banUser.findMany({
        where: { userId },
        select: { channelId: true },
      });

      const bannedChannelIds = bannedChannels.map((ban) => ban.channelId);

      // If user is banned from any channels, exclude their content
      if (bannedChannelIds.length > 0) {
        where.channelId = {
          ...(where.channelId || {}),
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
                select: publicUserSelect,
              },
            },
          },
        },
      }),
      this.prisma.content.count({ where }),
    ]);

    const dataWithViewers = data.map((content) => ({
      ...content,
      concurrentViewers:
        content.contentType === 'LIVE_STREAM'
          ? this.watchHistoryService.getActiveViewerCount(content.id)
          : 0,
    }));

    return {
      data: dataWithViewers,
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

  async getHeroBannerContent(userId?: string) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Common where clause for visibility
    const visibilityWhere: Prisma.ContentWhereInput = {};

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = user?.role === 'ADMIN';

      visibilityWhere.OR = [
        {
          isShadowBanned: false,
          channel: { owner: { isShadowBanned: false } },
        },
        { channel: { ownerId: userId } },
        ...(isAdmin
          ? [
              {
                OR: [
                  { isShadowBanned: true },
                  { channel: { owner: { isShadowBanned: true } } },
                ],
              },
            ]
          : []),
      ];
    } else {
      visibilityWhere.isShadowBanned = false;
      visibilityWhere.channel = { owner: { isShadowBanned: false } };
    }

    // 1. Top Live Streams (Candidate list)
    const liveStreams = await this.prisma.content.findMany({
      where: {
        status: 'AVAILABLE',
        contentType: 'LIVE_STREAM',
        AND: [visibilityWhere],
      },
      take: 10,
      orderBy: { views: 'desc' },
      include: {
        channel: {
          select: {
            ...safeChannelSelect,
            owner: {
              select: {
                id: true,
                firstName: true,
                profileImage: true,
                username: true,
              },
            },
          },
        },
      },
    });

    // Map real-time viewer count and sort
    const mappedLive = liveStreams
      .map((item) => ({
        ...item,
        concurrentViewers: this.watchHistoryService.getActiveViewerCount(
          item.id,
        ),
      }))
      .sort((a, b) => b.concurrentViewers - a.concurrentViewers)
      .slice(0, 3);

    // 2. Top 3 VODs (Weekly)
    const topVODs = await this.prisma.content.findMany({
      where: {
        status: 'AVAILABLE',
        contentType: 'VOD',
        createdAt: { gte: oneWeekAgo },
        AND: [visibilityWhere],
      },
      take: 3,
      orderBy: { views: 'desc' },
      include: {
        channel: {
          select: {
            ...safeChannelSelect,
            owner: {
              select: {
                id: true,
                firstName: true,
                profileImage: true,
                username: true,
              },
            },
          },
        },
      },
    });

    return {
      topLiveStreams: mappedLive,
      topVODs: topVODs,
    };
  }

  async liveOnRappioList(query: QueryContentDto, userId?: string) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.ContentWhereInput = {
      status: 'AVAILABLE',
      contentType: 'LIVE_STREAM',
    };

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      const isAdmin = user?.role === 'ADMIN';

      where.AND = [
        {
          OR: [
            {
              isShadowBanned: false,
              channel: { owner: { isShadowBanned: false } },
            },
            { channel: { ownerId: userId } },
            ...(isAdmin
              ? [
                  {
                    OR: [
                      { isShadowBanned: true },
                      { channel: { owner: { isShadowBanned: true } } },
                    ],
                  },
                ]
              : []),
          ],
        },
      ];
    } else {
      where.isShadowBanned = false;
      where.channel = { owner: { isShadowBanned: false } };
    }

    const [content, total] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { views: 'desc' },
        include: {
          channel: {
            select: {
              ...safeChannelSelect,
              owner: {
                select: {
                  id: true,
                  firstName: true,
                  profileImage: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.content.count({ where }),
    ]);

    const mappedContent = content.map((item) => ({
      ...item,
      concurrentViewers:
        item.contentType === 'LIVE_STREAM'
          ? this.watchHistoryService.getActiveViewerCount(item.id)
          : 0,
      totalViews: item.views,
    }));

    return {
      data: mappedContent,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getHomeCategorizedStreams(userId?: string) {
    const categories = ['IRL', 'JUST_CHATTING', 'CASINO_GAMES'];

    const categorizedData = await Promise.all(
      categories.map(async (cat) => {
        const where: Prisma.ContentWhereInput = {
          status: 'AVAILABLE',
          contentType: 'LIVE_STREAM',
          category: cat as any,
        };

        // Apply shadow-ban filters
        if (userId) {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
          });
          const isAdmin = user?.role === 'ADMIN';

          where.AND = [
            {
              OR: [
                {
                  isShadowBanned: false,
                  channel: { owner: { isShadowBanned: false } },
                },
                { channel: { ownerId: userId } },
                ...(isAdmin
                  ? [
                      {
                        OR: [
                          { isShadowBanned: true },
                          { channel: { owner: { isShadowBanned: true } } },
                        ],
                      },
                    ]
                  : []),
              ],
            },
          ];
        } else {
          where.isShadowBanned = false;
          where.channel = { owner: { isShadowBanned: false } };
        }

        const streams = await this.prisma.content.findMany({
          where,
          take: 12, // Sufficient for a horizontal row
          orderBy: [{ views: 'desc' }, { createdAt: 'desc' }],
          include: {
            channel: {
              select: {
                ...safeChannelSelect,
                owner: {
                  select: {
                    id: true,
                    firstName: true,
                    profileImage: true,
                  },
                },
              },
            },
          },
        });

        const mappedStreams = streams.map((item) => ({
          ...item,
          concurrentViewers: this.watchHistoryService.getActiveViewerCount(
            item.id,
          ),
          totalViews: item.views,
        }));

        // Sort by concurrent viewers primary
        mappedStreams.sort((a, b) => b.concurrentViewers - a.concurrentViewers);

        return {
          category: cat,
          streams: mappedStreams,
        };
      }),
    );

    return categorizedData;
  }

  async findOne(id: string, userId?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            ...safeChannelSelect,
            owner: {
              select: {
                ...publicUserSelect,
                role: true,
                isShadowBanned: true,
              },
            },
          },
        },
        watchHistory: { orderBy: { createdAt: 'desc' }, take: 50 }, // example
      },
    });

    if (!content) throw new NotFoundException('Content not found');

    // Shadow ban protection for direct access
    const isShadowBanned =
      content.isShadowBanned || content.channel?.owner?.isShadowBanned;

    if (isShadowBanned) {
      let canSee = false;
      if (userId) {
        if (content.channel?.ownerId === userId) {
          canSee = true;
        } else {
          const requestingUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
          });
          if (requestingUser?.role === 'ADMIN') {
            canSee = true;
          }
        }
      }

      if (!canSee) {
        throw new NotFoundException('Content not found');
      }
    }

    const concurrentViewers =
      content.contentType === 'LIVE_STREAM'
        ? this.watchHistoryService.getActiveViewerCount(id)
        : 0;

    return {
      ...content,
      concurrentViewers,
      totalViews: content.views,
    };
  }

  async update(id: string, dto: UpdateContentDto) {
    // ensure content exists
    if (!id) {
      throw new BadRequestException('ID is required');
    }
    const isExists = await this.prisma.content.findUnique({
      where: { id },
    });
    if (!isExists) {
      throw new NotFoundException(`Content with ID ${id} not found`);
    }
    const data: any = { ...dto };
    if (dto.channelId) {
      data.channel = { connect: { id: (dto as any).channelId } };
      delete data.channelId;
    }

    const updated = await this.prisma.content.update({
      where: { id },
      data: {
        ...data,
        category: dto.category,
      },
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
      throw new ForbiddenException(
        'You are not authorized to delete this content. Only the channel owner can delete content.',
      );
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

    const orderBy =
      sortBy === ContentSortBy.MOST_VIEWED
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
      data: { status: newStatus },
    });
  }

  async toggleShadowBan(id: string, isShadowBanned: boolean) {
    const shadowBanValue =
      String(isShadowBanned) === 'true' || isShadowBanned === true;
    console.log(
      `[toggleShadowBan] id: ${id}, isShadowBanned (raw): ${isShadowBanned}, shadowBanValue (resolved): ${shadowBanValue}`,
    );

    const content = await this.prisma.content.findUnique({
      where: { id },
      include: { channel: true }, // ✅ Include channel to check live status
    });

    if (!content) throw new NotFoundException('Content not found');

    let newStatus = content.status;

    if (shadowBanValue) {
      // 🔴 Banning: Always set to SHADOW_BANNED
      newStatus = 'SHADOW_BANNED' as any;
    } else {
      // 🟢 Unbanning: Restore correct status
      if (content.contentType === 'LIVE_STREAM') {
        // Check if channel is actually live
        if (content.channel?.isLive) {
          newStatus = 'AVAILABLE' as any;
        } else {
          newStatus = 'ENDED' as any; // If channel is offline, stream is ENDED
        }
      } else {
        // VOD is always available if unbanned
        newStatus = 'AVAILABLE' as any;
      }
    }

    console.log(
      `[toggleShadowBan] setting isShadowBanned to ${shadowBanValue} and status to ${newStatus}`,
    );

    const result = await this.prisma.content.update({
      where: { id },
      data: {
        isShadowBanned: shadowBanValue,
        status: newStatus,
      },
    });
    return result;
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
  async incrementViews(id: string, userId?: string, ipAddress?: string) {
    return this.watchHistoryService.incrementViews(id, userId, ipAddress);
  }
}
