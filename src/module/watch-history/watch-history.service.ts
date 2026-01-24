import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';

@Injectable()
export class WatchHistoryService {
  private readonly logger = new Logger(WatchHistoryService.name);

  // Track active viewers per content (in-memory)
  private activeViewers = new Map<string, Set<string>>();

  // Cache to prevent duplicate view count increments (ContentId -> Map<ViewerIdentity, ExpiryTime>)
  private recentViewers = new Map<string, Map<string, number>>();
  private readonly RECENT_VIEW_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => LiveCommentGateway))
    private liveGateway: LiveCommentGateway, // Inject WebSocket gateway
  ) {}

  // Increment view count for content NOW WITH WEBSOCKET BROADCAST

  async incrementViews(contentId: string, userId?: string, ipAddress?: string) {
    const now = Date.now();
    // Unique key for in-memory cache (performance layer)
    const viewerKey = userId ? `u:${userId}` : `ip:${ipAddress || 'unknown'}`;

    // 1. In-memory deduplication check (Fast bypass)
    if (!this.recentViewers.has(contentId)) {
      this.recentViewers.set(contentId, new Map());
    }
    const contentRecentViewers = this.recentViewers.get(contentId)!;
    const lastViewTime = contentRecentViewers.get(viewerKey);

    if (lastViewTime && now - lastViewTime < this.RECENT_VIEW_TTL) {
      this.logger.debug(
        `Skipping view (In-Memory) for ${contentId} (recent view from ${viewerKey})`,
      );
      return { success: true, duplicated: true };
    }

    // 2. Persistent Database check (Authority layer)
    const existingTrack = await (this.prisma as any).viewTrack.findFirst({
      where: {
        contentId,
        OR: userId ? [{ userId }] : [{ ipAddress, userId: null }],
      },
    });

    if (existingTrack) {
      // Update in-memory cache to avoid repeated DB calls for this duplicated view
      contentRecentViewers.set(viewerKey, now);
      this.logger.debug(
        `Skipping view (Database) for ${contentId} (persistent view from ${viewerKey})`,
      );
      return { success: true, duplicated: true };
    }

    this.logger.log(`Incrementing view count for content ${contentId}`);

    // Check if content exists
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        title: true,
        views: true,
        contentType: true,
      },
    });

    if (!content) {
      this.logger.warn(
        `Increment attempt failed: Content ${contentId} not found`,
      );
      return { success: false, error: 'Content not found' };
    }

    // Perform atomic transaction: Create ViewTrack AND Increment View
    const [updated] = await this.prisma.$transaction([
      this.prisma.content.update({
        where: { id: contentId },
        data: { views: { increment: 1 } },
        select: { id: true, views: true, contentType: true },
      }),
      (this.prisma as any).viewTrack.create({
        data: {
          contentId,
          userId: userId || null,
          ipAddress: userId ? null : ipAddress || null,
        },
      }),
    ]);

    // Update in-memory cache
    contentRecentViewers.set(viewerKey, now);

    this.logger.log(
      `View count incremented persistently for content ${contentId}: ${content.views} → ${updated.views}`,
    );

    // BROADCAST VIEW COUNT UPDATE TO ALL VIEWERS
    this.liveGateway.broadcastViewCount(contentId, updated.views);

    // For live streams, also track concurrent viewers
    if (updated.contentType === 'LIVE_STREAM') {
      const concurrentViewers = this.getActiveViewerCount(contentId);
      this.liveGateway.broadcastConcurrentViewers(contentId, concurrentViewers);
    }

    return {
      success: true,
      contentId: updated.id,
      views: updated.views,
    };
  }

  // Track when user starts watching (for concurrent viewer count)

  async startWatching(
    contentId: string,
    viewerId: string,
    userId?: string,
    ipAddress?: string,
  ) {
    // Add user to active viewers
    if (!this.activeViewers.has(contentId)) {
      this.activeViewers.set(contentId, new Set());
    }

    const viewers = this.activeViewers.get(contentId)!;
    // For active viewers set, we use viewerId (socket.id or userId) to track actual open tabs/connections
    const isNewToSession = !viewers.has(viewerId);
    viewers.add(viewerId);

    const concurrentCount = viewers.size;

    this.logger.log(
      `Viewer ${viewerId} started watching ${contentId} (${concurrentCount} concurrent)`,
    );

    // Broadcast concurrent viewer count
    this.liveGateway.broadcastConcurrentViewers(contentId, concurrentCount);

    // Increment total views ONLY if this is a new viewer in this session
    if (isNewToSession) {
      await this.incrementViews(contentId, userId, ipAddress);
    }

    return { concurrentViewers: concurrentCount };
  }

  // Track when user stops watching

  async stopWatching(contentId: string, viewerId: string) {
    const viewers = this.activeViewers.get(contentId);

    if (viewers) {
      viewers.delete(viewerId);
      const concurrentCount = viewers.size;

      this.logger.log(
        `Viewer ${viewerId} stopped watching ${contentId} (${concurrentCount} remaining)`,
      );

      // Broadcast updated concurrent viewer count
      this.liveGateway.broadcastConcurrentViewers(contentId, concurrentCount);

      // Clean up if no viewers left
      if (concurrentCount === 0) {
        this.activeViewers.delete(contentId);
      }

      return { concurrentViewers: concurrentCount };
    }

    return { concurrentViewers: 0 };
  }

  // Get current concurrent viewers for a content

  getActiveViewerCount(contentId: string): number {
    return this.activeViewers.get(contentId)?.size || 0;
  }

  // Get content with view count and concurrent viewers

  async findOne(id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            handle: true,
            logo: true,
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

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    // Add concurrent viewer count for live streams
    const concurrentViewers =
      content.contentType === 'LIVE_STREAM' ? this.getActiveViewerCount(id) : 0;

    return {
      ...content,
      concurrentViewers,
    };
  }

  // Get top viewed content

  async getTopViewed(limit = 10) {
    const contents = await this.prisma.content.findMany({
      where: {
        status: 'AVAILABLE',
      },
      orderBy: {
        views: 'desc',
      },
      take: Math.min(limit, 50),
      select: {
        id: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        playbackUrl: true,
        views: true,
        durationSeconds: true,
        isPremium: true,
        contentType: true,
        createdAt: true,
        channel: {
          select: {
            id: true,
            name: true,
            handle: true,
            logo: true,
          },
        },
      },
    });

    // Add concurrent viewer count for each live stream
    return contents.map((content) => ({
      ...content,
      concurrentViewers:
        content.contentType === 'LIVE_STREAM'
          ? this.getActiveViewerCount(content.id)
          : 0,
    }));
  }

  // Get total watch time for a content in seconds
  async getTotalWatchTime(contentId: string): Promise<number> {
    const aggregate = await this.prisma.watchHistory.aggregate({
      where: { contentId },
      _sum: {
        progressSeconds: true,
      },
    });

    return aggregate._sum.progressSeconds || 0;
  }

  // Get analytics for a specific content
  async getContentAnalytics(contentId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        title: true,
        views: true,
        contentType: true,
        createdAt: true,
      },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    const concurrentViewers = this.getActiveViewerCount(contentId);
    const totalWatchTime = await this.getTotalWatchTime(contentId);

    return {
      contentId: content.id,
      title: content.title,
      totalViews: content.views,
      concurrentViewers,
      totalWatchTime,
      contentType: content.contentType,
      createdAt: content.createdAt,
    };
  }

  // Cleanup: Remove inactive viewers and expired recent viewer cache entries
  cleanupInactiveViewers() {
    let activeCleaned = 0;
    let recentCleaned = 0;
    const now = Date.now();

    // Cleanup active viewers
    for (const [contentId, viewers] of this.activeViewers.entries()) {
      if (viewers.size === 0) {
        this.activeViewers.delete(contentId);
        activeCleaned++;
      }
    }

    // Cleanup recent viewers cache
    for (const [contentId, viewerMap] of this.recentViewers.entries()) {
      for (const [viewerKey, timestamp] of viewerMap.entries()) {
        if (now - timestamp > this.RECENT_VIEW_TTL) {
          viewerMap.delete(viewerKey);
          recentCleaned++;
        }
      }
      if (viewerMap.size === 0) {
        this.recentViewers.delete(contentId);
      }
    }

    if (activeCleaned > 0 || recentCleaned > 0) {
      this.logger.log(
        `Cleanup: Removed ${activeCleaned} empty active sets and ${recentCleaned} expired view cache entries`,
      );
    }
  }
}
