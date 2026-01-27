import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BanType, UserStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../user/dto/publicUserSelect';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { GetChannelsDto } from './dto/get-channels-query.dto';
import { safeChannelSelect } from './dto/safeChannelSelect';
import { UpdateChannelDto } from './dto/update-channel.dto';

import { R2UploadService } from '../video/r2-upload.service';

@Injectable()
export class ChannelService {
  constructor(
    private prisma: PrismaService,
    private watchHistoryService: WatchHistoryService,
    private readonly r2UploadService: R2UploadService,
  ) { }
  private generateStreamKey(): string {
    return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  }

  /**Creates a channel for a new CREATOR user.*/
  async createChannelForCreator(userId: string, name: string) {
    const existingChannel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
    });

    if (existingChannel) {
      throw new BadRequestException('User already owns a channel.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    if (!user || !user.username) {
      throw new NotFoundException('User not found.');
    }

    return this.prisma.channel.create({
      data: {
        ownerId: userId,
        name,
        handle: user.username,
        streamKey: this.generateStreamKey(),
      },
    });
  }

  /**Retrieves channel profile and content for public view.*/
  // async getPublicChannel(handle: string) {
  //   const channel = await this.prisma.channel.findUnique({
  //     where: { handle },
  //     include: {
  //       content: {
  //         where: { status: 'AVAILABLE', contentType: { not: 'LIVE_STREAM' } }, // Only show VODs
  //         orderBy: { createdAt: 'desc' },
  //       },
  //       Following: { select: { followerId: true } }, // Get list of followers for count
  //     },
  //   });
  //
  //   if (!channel) {
  //     throw new NotFoundException(`Channel ${handle} not found.`);
  //   }
  //
  //   return {
  //     id: channel.id,
  //     name: channel.name,
  //     handle: channel.handle,
  //     description: channel.description,
  //     ownerId: channel.ownerId,
  //     contentCount: channel.content.length,
  //     followerCount: channel.follow.length,
  //     content: channel.content,
  //   };
  // }
  async getPublicChannel(handle: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { handle },
      include: {
        content: {
          where: { status: 'AVAILABLE', contentType: { not: 'LIVE_STREAM' } }, // Only show VODs
          orderBy: { createdAt: 'desc' },
        },
        // FIX: Changed 'Following' to 'follow' to match the schema field name
        follow: { select: { followerId: true } }, // Get list of followers for count
      },
    });

    if (!channel) {
      throw new NotFoundException(`Channel ${handle} not found.`);
    }

    return {
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      description: channel.description,
      ownerId: channel.ownerId,
      // FIX: The included relation 'content' is now correctly recognized
      contentCount: channel.content.length,
      // FIX: The included relation 'follow' is now correctly recognized
      followerCount: channel.follow.length,
      content: channel.content,
    };
  }
  /**Retrieves full private channel details for the owner/creator.*/
  // channel.service.ts
  async getPrivateChannel(userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            profileImage: true,
          },
        },
        _count: {
          select: {
            content: true, // Total content count
            follow: true, // Total followers
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Creator channel not found.');
    }

    //  Calculate total views (sum of all content views)
    const totalViews = await this.prisma.content.aggregate({
      where: {
        channelId: channel.id,
      },
      _sum: {
        views: true,
      },
    });

    // Get additional statistics
    await this.prisma.content.count({
      where: {
        channelId: channel.id,
        contentType: 'LIVE_STREAM',
      },
    });

    await this.prisma.content.count({
      where: {
        channelId: channel.id,
        contentType: 'VOD',
      },
    });

    // Destructure _count and restructure response
    const { _count, ...channelData } = channel;

    return {
      ...channelData,
      statistics: {
        totalViews: totalViews._sum.views || 0,
        totalContent: _count.content,
        totalFollowers: _count.follow,
      },
    };
  }

  /**Allows channel owner to update name, description, and handle (with rate limit).*/
  async updateChannel(userId: string, data: UpdateChannelDto) {
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }
    const isOwner = channel.ownerId === userId;
    if (!isOwner) {
      throw new ForbiddenException(
        'You are not authorized to updated this channel. Only the channel owner can updated channel.',
      );
    }

    // 2. Logic for About Section Rate Limit (5 minutes)
    const aboutFields = [
      'description',
      'websiteUrl',
      'twitterUrl',
      'youtubeUrl',
      'discordUrl',
      'instagramUrl',
      'category',
    ];
    const isUpdatingAbout = aboutFields.some(
      (field) => data[field] !== undefined,
    );

    if (isUpdatingAbout) {
      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

      if (channel.lastAboutUpdate > fiveMinutesAgo) {
        throw new BadRequestException(
          'Please wait 5 minutes between profile updates.',
        );
      }
    }

    // 3. Sanitization & URL Validation
    if (data.description) {
      // Basic strip HTML/scripts
      data.description = data.description.replace(/<[^>]*>?/gm, '');
    }

    const urlFields = [
      'websiteUrl',
      'twitterUrl',
      'youtubeUrl',
      'discordUrl',
      'instagramUrl',
    ];
    for (const field of urlFields) {
      if (data[field]) {
        try {
          // Add protocol if missing for validation
          let urlToTest = data[field];
          if (!urlToTest.startsWith('http')) {
            urlToTest = 'https://' + urlToTest;
          }
          new URL(urlToTest);
          // Update the data with at least https if it was missing
          if (!data[field].startsWith('http')) {
            data[field] = 'https://' + data[field];
          }
        } catch (e) {
          throw new BadRequestException(`Invalid URL format for ${field}`);
        }
      }
    }

    return this.prisma.channel.update({
      where: { ownerId: userId },
      data: {
        ...data,
        lastAboutUpdate: isUpdatingAbout ? new Date() : channel.lastAboutUpdate,
      },
    });
  }

  /**Security critical: Generates a new stream key for the channel owner.*/
  // async rotateStreamKey(userId: string): Promise<{ streamKey: string }> {
  //   const newKey = this.generateStreamKey();
  //
  //   await this.prisma.channel.update({
  //     // where: { ownerId: userId },
  //     // data: { streamKey: newKey },
  //     where: { ownerId: userId }, // <-- This is the lookup criteria
  //     data: { streamKey: newKey },
  //   });
  //
  //   // Future: Log this security event
  //
  //   return { streamKey: newKey };
  // }
  async rotateStreamKey(userId: string): Promise<{ streamKey: string }> {
    // FIX: Select the channel ID and check for existence
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });

    if (!channel) {
      // This exception should be hit if the channel record is missing
      throw new NotFoundException(
        'Channel not found. Cannot rotate key without a channel record.',
      );
    }

    const newKey = this.generateStreamKey();

    // FIX: Using the retrieved primary key (id) for the update
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { streamKey: newKey },
    });

    // Future: Log this security event

    return { streamKey: newKey };
  }
  /**Internal function used by the RTMP server to authenticate the stream.*/
  async validateStreamKey(key: string): Promise<boolean> {
    const channel = await this.prisma.channel.findUnique({
      where: { streamKey: key },
      select: { owner: { select: { status: true } } },
    });

    if (!channel) {
      return false;
    }

    return channel.owner.status === 'ACTIVE';
  }

  async getChannels(dto: GetChannelsDto) {
    const { search, page = 1, limit = 10 } = dto;
    const skip = (page - 1) * limit;

    // Build where clause for search
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { handle: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    if (dto.category) {
      where.category = dto.category;
    }


    // Get total count for pagination
    const total = await this.prisma.channel.count({ where });

    // Fetch channels with pagination
    const channels = await this.prisma.channel.findMany({
      where,
      select: {
        ...safeChannelSelect,
        owner: {
          select: publicUserSelect,
        },
        _count: {
          select: {
            content: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get views for the channels
    const channelIds = channels.map((c) => c.id);
    const views = await this.prisma.content.groupBy({
      by: ['channelId'],
      where: {
        channelId: { in: channelIds },
      },
      _sum: {
        views: true,
      },
    });

    const viewsMap = new Map(
      views.map((v) => [v.channelId, v._sum.views ?? 0]),
    );

    const data = channels.map((channel) => ({
      ...channel,
      totalViews: viewsMap.get(channel.id) ?? 0,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  async getChannelById(channelId: string) {
    // Get channel with all details and counts
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        ...safeChannelSelect,
        owner: {
          select: publicUserSelect,
        },
        _count: {
          select: {
            content: true,
            follow: true,
          },
        },
        content: {
          where: {
            contentType: 'LIVE_STREAM',
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            playbackUrl: true,
            createdAt: true,
            status: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found.');
    }

    // Optional: ensure owner is ACTIVE
    if (channel.owner.status !== 'ACTIVE') {
      throw new ForbiddenException('Channel owner is not active.');
    }

    //  Calculate total views (sum of all content views)
    const totalViews = await this.prisma.content.aggregate({
      where: {
        channelId: channel.id,
      },
      _sum: {
        views: true,
      },
    });

    //  Get content breakdown by type
    await Promise.all([
      this.prisma.content.count({
        where: {
          channelId: channel.id,
          contentType: 'LIVE_STREAM',
        },
      }),
      this.prisma.content.count({
        where: {
          channelId: channel.id,
          contentType: 'VOD',
        },
      }),
    ]);

    // Destructure _count and content, then restructure response
    const { _count, content, ...channelData } = channel;

    const latestStream = content?.length > 0 ? content[0] : null;

    return {
      ...channelData,
      latestStream,
      statistics: {
        totalViews: totalViews._sum.views || 0,
        totalContent: _count.content,
        totalFollowers: _count.follow,
        // liveStreamCount,
        // vodCount,
      },
    };
  }

  async getChannelByUsername(usernameOrHandle: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: usernameOrHandle },
      select: { id: true },
    });

    if (user) {
      const channel = await this.prisma.channel.findUnique({
        where: { ownerId: user.id },
        select: { id: true },
      });

      if (!channel) {
        throw new NotFoundException('Channel not found.');
      }

      return this.getChannelById(channel.id);
    }

    const channelByHandle = await this.prisma.channel.findUnique({
      where: { handle: usernameOrHandle },
      select: { id: true },
    });

    if (!channelByHandle) {
      throw new NotFoundException('Channel not found.');
    }

    return this.getChannelById(channelByHandle.id);
  }

  async getContentByChannelId(
    channelId: string,
    page: number = 1,
    limit: number = 10,
    filter: 'all' | 'videos' | 'recordings' = 'all',
    sort: 'newest' | 'most_viewed' = 'newest',
  ) {
    // Validate pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Max 100 items per page
    const skip = (validPage - 1) * validLimit;

    const where: any = { channelId: channelId };

    // Apply filters
    if (filter === 'videos') {
      where.contentType = 'VOD';
      where.status = 'AVAILABLE'; // Standard uploaded videos
    } else if (filter === 'recordings') {
      where.status = 'ARCHIVED'; // Stream recordings
    } else {
      // 'all' - show anything that is public
      where.status = { in: ['AVAILABLE', 'ARCHIVED'] };
    }

    // Apply sorting
    const orderBy: any =
      sort === 'most_viewed' ? { views: 'desc' } : { createdAt: 'desc' };

    // Get total count
    const total = await this.prisma.content.count({ where });

    // Get paginated data
    const contents = await this.prisma.content.findMany({
      where,
      skip: skip,
      take: validLimit,
      orderBy,
    });

    return {
      contents,
      total,
      totalPages: Math.ceil(total / validLimit),
    };
  }

  /**
   * Check if user is banned from channel
   */
  async isUserBanned(channelId: string, userId: string): Promise<boolean> {
    const ban = await this.prisma.banUser.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
    });

    if (!ban) return false;

    // Check if temporary ban has expired
    if (ban.banType === BanType.TEMPORARY && ban.expiresAt) {
      if (new Date() > ban.expiresAt) {
        // Auto-remove expired ban
        await this.prisma.banUser.delete({
          where: {
            channelId_userId: {
              channelId,
              userId,
            },
          },
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Clean up expired temporary bans (run via cron job)
   */
  async cleanExpiredBans() {
    const result = await this.prisma.banUser.deleteMany({
      where: {
        banType: BanType.TEMPORARY,
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    return { deleted: result.count };
  }

  // Get recommended channels for a user
  async getRecommendedChannels(userId: string | null, limit: number = 5) {
    let followedChannelIds: string[] = [];

    // STEP 1: Get followed channels only if user is authenticated
    if (userId) {
      const follows = await this.prisma.follow.findMany({
        where: {
          followerId: userId,
        },
        select: {
          followingId: true,
        },
      });

      followedChannelIds = follows.map((f) => f.followingId);
    }

    const exclusionFilter = {
      owner: {
        // role: { not: UserRole.ADMIN },
        isBanned: false,
        isShadowBanned: false,
        status: UserStatus.ACTIVE,
      },
    };

    const notInFollowed = {
      id: {
        notIn: followedChannelIds.length > 0 ? followedChannelIds : undefined,
      },
    };

    // STEP 2: Similar / Active channels
    const similarChannels = await this.prisma.channel.findMany({
      where: {
        ...notInFollowed,
        ...exclusionFilter,
        content: {
          some: {
            status: 'AVAILABLE',
          },
        },
      },
      select: {
        ...safeChannelSelect,
        owner: {
          select: publicUserSelect,
        },
        _count: {
          select: {
            follow: true,
            content: true,
          },
        },
      },
      take: 20,
    });

    // STEP 3: Popular channels (by followers)
    const popularChannels = await this.prisma.channel.findMany({
      where: {
        ...notInFollowed,
        ...exclusionFilter,
      },
      select: {
        ...safeChannelSelect,
        owner: {
          select: publicUserSelect,
        },
        _count: {
          select: {
            follow: true,
            content: true,
          },
        },
      },
      orderBy: {
        follow: {
          _count: 'desc',
        },
      },
      take: 20,
    });

    // STEP 4: Live channel boost
    const liveChannels = await this.prisma.channel.findMany({
      where: {
        isLive: true,
        ...notInFollowed,
        ...exclusionFilter,
      },
      select: {
        ...safeChannelSelect,
        owner: {
          select: publicUserSelect,
        },
        _count: {
          select: {
            follow: true,
            content: true,
          },
        },
      },
      take: 15,
    });

    // STEP 5: High-view channels
    const highViewContent = await this.prisma.content.groupBy({
      by: ['channelId'],
      where: {
        status: 'AVAILABLE',
        channelId: { not: null },
      },
      _sum: {
        views: true,
      },
      orderBy: {
        _sum: {
          views: 'desc',
        },
      },
      take: 30,
    });

    const highViewChannelIds = highViewContent
      .map((c) => c.channelId)
      .filter((id): id is string => !!id && !followedChannelIds.includes(id));

    const highViewChannels = await this.prisma.channel.findMany({
      where: {
        id: { in: highViewChannelIds },
        ...exclusionFilter,
      },
      select: {
        ...safeChannelSelect,
        owner: {
          select: publicUserSelect,
        },
        _count: {
          select: {
            follow: true,
            content: true,
          },
        },
      },
      take: 20,
    });

    // STEP 6: Merge + unique
    const channelMap = new Map<string, any>();

    [
      ...similarChannels,
      ...popularChannels,
      ...liveChannels,
      ...highViewChannels,
    ].forEach((channel) => {
      if (!channelMap.has(channel.id)) {
        channelMap.set(channel.id, channel);
      }
    });

    const allCandidateIds = Array.from(channelMap.keys());

    // STEP 7: Fetch total views for ALL candidates for accurate scoring
    const candidateViews = await this.prisma.content.groupBy({
      by: ['channelId'],
      where: {
        channelId: { in: allCandidateIds },
        status: 'AVAILABLE',
      },
      _sum: {
        views: true,
      },
    });

    const viewsMap = new Map<string, number>(
      candidateViews.map((v) => [v.channelId as string, v._sum.views || 0]),
    );

    // STEP 8: Score system
    const mappedChannels = await Promise.all(
      Array.from(channelMap.values()).map(async (channel) => {
        const channelData = channel as any;

        const totalViews = viewsMap.get(channelData.id) || 0;
        const followCount = channelData._count?.follow || 0;
        const contentCount = channelData._count?.content || 0;
        const isLive = channelData.isLive || false;

        let category = channelData.category || null;
        let currentViewers = 0;

        if (isLive) {
          // Fetch latest live stream for this channel
          const liveStream = await this.prisma.content.findFirst({
            where: {
              channelId: channelData.id,
              contentType: 'LIVE_STREAM',
              status: 'AVAILABLE',
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, category: true },
          });

          if (liveStream) {
            category = liveStream.category || category;
            currentViewers = this.watchHistoryService.getActiveViewerCount(
              liveStream.id,
            );
          }
        }

        const score =
          followCount * 2 +
          contentCount +
          (isLive ? 10 : 0) +
          Math.floor(totalViews / 50);

        return {
          id: channelData.id,
          name: channelData.name,
          handle: channelData.handle,
          logo: channelData.logo,
          description: channelData.description,
          isLive: !!isLive,
          category,
          currentViewers,
          owner: channelData.owner,
          followers: followCount,
          contents: contentCount,
          totalViews,
          score,
        };
      }),
    );

    // STEP 9: Sort + limit
    mappedChannels.sort((a, b) => b.score - a.score);

    return mappedChannels.slice(0, limit);
  }

  // --- Custom Emojis ---

  async addCustomEmoji(
    userId: string,
    code: string,
    file: Express.Multer.File,
  ) {
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    // Check code uniqueness in channel
    const existing = await this.prisma.channelEmoji.findUnique({
      where: {
        channelId_code: {
          channelId: channel.id,
          code,
        },
      },
    });
    if (existing)
      throw new BadRequestException(
        'Emoji code already exists in this channel',
      );

    const url = await this.uploadEmojiImage(file, channel.id, code);

    return this.prisma.channelEmoji.create({
      data: {
        code, // ensure it starts with : and ends with : ? user can provide "pepe", we might store ":pepe:"
        url,
        channelId: channel.id,
      },
    });
  }

  async removeCustomEmoji(userId: string, emojiId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { ownerId: userId },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const emoji = await this.prisma.channelEmoji.findUnique({
      where: { id: emojiId },
    });
    if (!emoji) throw new NotFoundException('Emoji not found');
    if (emoji.channelId !== channel.id)
      throw new ForbiddenException('You cannot delete this emoji');

    return this.prisma.channelEmoji.delete({ where: { id: emojiId } });
  }

  async getCustomEmojis(channelId: string) {
    return this.prisma.channelEmoji.findMany({ where: { channelId } });
  }

  private async uploadEmojiImage(
    file: Express.Multer.File,
    channelId: string,
    code: string,
  ): Promise<string> {
    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPG, PNG, WEBP, GIF are allowed',
      );
    }
    // Max 512KB for emojis
    const maxSize = 512 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size must not exceed 512KB');
    }

    try {
      const timestamp = Date.now();
      const extension = file.originalname.split('.').pop();
      // Sanitise code for filename
      const safeCode = code.replace(/[^a-zA-Z0-9]/g, '');
      const r2Key = `emojis/${channelId}/${safeCode}-${timestamp}.${extension}`;

      return await this.r2UploadService.uploadBuffer(
        file.buffer,
        r2Key,
        file.mimetype,
      );
    } catch (error) {
      throw new BadRequestException('Failed to upload emoji: ' + error.message);
    }
  }
}
