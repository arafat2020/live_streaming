/**
 * @fileoverview Content Service
 *
 * Manages content lifecycle (VOD, live streams) including CRUD operations,
 * discovery feeds (hero banner, categorized streams, live listings),
 * shadow-ban visibility filtering, and admin operations.
 *
 * @module ContentService
 */

import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildShadowBanFilter } from '../../common/helpers/shadow-ban-filter.helper';
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

  /**
   * Creates a new content record (VOD or live stream).
   *
   * @param dto - Content creation data.
   * @returns The created content record.
   */
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
        r2Prefix: dto.r2Prefix,
        category: dto.category,
        channel: { connect: { id: dto.channelId } },
      },
    });

    return content;
  }

  /**
   * Retrieves a paginated, filterable list of content.
   * Respects shadow-ban visibility rules and excludes banned channel content.
   *
   * @param query  - Pagination, search, and filter parameters.
   * @param userId - Authenticated user's ID (optional, for visibility rules).
   * @returns Paginated content with channel info and concurrent viewer counts.
   */
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

    // Shadow-ban visibility filter
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = user?.role === 'ADMIN';
      const shadowFilter = buildShadowBanFilter(userId, isAdmin);
      where.AND = [...(where.AND || []), shadowFilter];
    } else {
      Object.assign(where, buildShadowBanFilter());
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

  /**
   * Retrieves hero banner content: top live streams and top weekly VODs.
   *
   * @param userId - Authenticated user's ID (optional, for visibility rules).
   * @returns Top live streams and top VODs for the hero section.
   */
  async getHeroBannerContent(userId?: string) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Build visibility filter
    let visibilityWhere: Prisma.ContentWhereInput;
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = user?.role === 'ADMIN';
      visibilityWhere = buildShadowBanFilter(userId, isAdmin);
    } else {
      visibilityWhere = buildShadowBanFilter();
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
      .slice(0, 5);

    // 2. Top 5 VODs (Weekly)
    const topVODs = await this.prisma.content.findMany({
      where: {
        status: 'AVAILABLE',
        contentType: 'VOD',
        createdAt: { gte: oneWeekAgo },
        AND: [visibilityWhere],
      },
      take: 5,
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

  /**
   * Retrieves a paginated list of currently live streams.
   *
   * @param query  - Pagination parameters.
   * @param userId - Authenticated user's ID (optional, for visibility rules).
   * @returns Paginated live stream content with viewer counts.
   */
  async liveOnRappioList(query: QueryContentDto, userId?: string) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.ContentWhereInput = {
      status: 'AVAILABLE',
      contentType: 'LIVE_STREAM',
    };

    // Shadow-ban visibility filter
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const isAdmin = user?.role === 'ADMIN';
      const shadowFilter = buildShadowBanFilter(userId, isAdmin);
      where.AND = [shadowFilter];
    } else {
      Object.assign(where, buildShadowBanFilter());
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

  /**
   * Retrieves live streams grouped by category for the home page.
   *
   * @param userId - Authenticated user's ID (optional, for visibility rules).
   * @returns Array of category objects, each with a list of live streams.
   */
  async getHomeCategorizedStreams(userId?: string) {
    const categories = ['IRL', 'JUST_CHATTING', 'CASINO_GAMES'];

    const categorizedData = await Promise.all(
      categories.map(async (cat) => {
        const where: Prisma.ContentWhereInput = {
          status: 'AVAILABLE',
          contentType: 'LIVE_STREAM',
          category: cat as any,
        };

        // Shadow-ban visibility filter
        if (userId) {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
          });
          const isAdmin = user?.role === 'ADMIN';
          const shadowFilter = buildShadowBanFilter(userId, isAdmin);
          where.AND = [shadowFilter];
        } else {
          Object.assign(where, buildShadowBanFilter());
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

  /**
   * Retrieves a single content item with full channel and watch history details.
   * Enforces shadow-ban visibility for direct access.
   *
   * @param id     - Content UUID.
   * @param userId - Authenticated user's ID (optional).
   * @returns Content with channel info and concurrent viewer count.
   * @throws {NotFoundException} If content is not found or shadow-banned from view.
   */
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

  /**
   * Updates a content record.
   *
   * @param id  - Content UUID.
   * @param dto - Fields to update.
   * @returns Updated content record.
   * @throws {NotFoundException} If content is not found.
   */
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

  /**
   * Deletes a content record. Only the channel owner or an admin can delete.
   *
   * @param id       - Content UUID.
   * @param userId   - ID of the requesting user.
   * @param userRole - Role of the requesting user.
   * @returns Success message.
   * @throws {NotFoundException} If content is not found.
   * @throws {ForbiddenException} If user is not authorized to delete.
   */
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
  /**
   * Admin-only: Retrieves all content without shadow-ban filtering.
   *
   * @param query - Pagination and filter parameters.
   * @returns Paginated content list with channel info.
   */
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

  /**
   * Toggles content visibility (public/private).
   *
   * @param id       - Content UUID.
   * @param isHidden - Whether to hide the content.
   * @returns Updated content record.
   * @throws {NotFoundException} If content is not found.
   */
  async toggleVisibility(id: string, isHidden: boolean) {
    const content = await this.prisma.content.findUnique({ where: { id } });
    if (!content) throw new NotFoundException('Content not found');

    const newStatus = isHidden ? 'PRIVATE' : 'AVAILABLE';

    return this.prisma.content.update({
      where: { id },
      data: { status: newStatus },
    });
  }

  /**
   * Toggles shadow-ban status on a content item.
   * Adjusts the content's status based on type and channel live state.
   *
   * @param id              - Content UUID.
   * @param isShadowBanned  - New shadow-ban state.
   * @returns Updated content record.
   * @throws {NotFoundException} If content is not found.
   */
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

  /**
   * Force-ends a live stream (admin action).
   *
   * @param id - Content UUID.
   * @returns Updated content record.
   * @throws {NotFoundException} If content is not found.
   * @throws {BadRequestException} If content is not a live stream.
   */
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

  /**
   * Increments the view count for a content item and records watch history.
   *
   * @param id        - Content UUID.
   * @param userId    - Viewer's user ID (optional).
   * @param ipAddress - Viewer's IP address (optional).
   * @returns Updated watch history record.
   */
  async incrementViews(id: string, userId?: string, ipAddress?: string) {
    return this.watchHistoryService.incrementViews(id, userId, ipAddress);
  }
}
