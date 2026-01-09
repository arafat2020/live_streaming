import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateWatchHistoryDto } from './dto/create-watch-history.dto';
import { UpdateWatchHistoryDto } from './dto/update-watch-history.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryWatchHistoryDto } from './dto/query-watch-history.dto';
import { Prisma } from '@prisma/client';
import { ContentService } from '../content/content.service';
import { LiveCommentGateway } from '../live-comment/liveComment.gateway';

@Injectable()
export class WatchHistoryService {
  private readonly logger = new Logger(WatchHistoryService.name);
  
  // Track active viewers per content (in-memory)
  private activeViewers = new Map<string, Set<string>>();

  constructor(
    private prisma: PrismaService,
    private liveGateway: LiveCommentGateway, // Inject WebSocket gateway
  ) {}


  // Increment view count for content NOW WITH WEBSOCKET BROADCAST
  
  async incrementViews(contentId: string, userId?: string) {
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
      throw new NotFoundException('Content not found');
    }

    // Increment view count in database
    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        views: {
          increment: 1,
        },
      },
      select: {
        id: true,
        views: true,
        contentType: true,
      },
    });

    this.logger.log(
      `View count incremented for content ${contentId}: ${content.views} → ${updated.views}`,
    );

    //  BROADCAST VIEW COUNT UPDATE TO ALL VIEWERS
    this.liveGateway.broadcastViewCount(contentId, updated.views);

    //  For live streams, also track concurrent viewers
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

  async startWatching(contentId: string, userId: string) {
    // Add user to active viewers
    if (!this.activeViewers.has(contentId)) {
      this.activeViewers.set(contentId, new Set());
    }
    
    const viewers = this.activeViewers.get(contentId)!;
    viewers.add(userId);
    
    const concurrentCount = viewers.size;
    
    this.logger.log(`User ${userId} started watching ${contentId} (${concurrentCount} concurrent)`);
    
    // Broadcast concurrent viewer count
    this.liveGateway.broadcastConcurrentViewers(contentId, concurrentCount);
    
    // Increment total views (only once per user session)
    await this.incrementViews(contentId, userId);
    
    return { concurrentViewers: concurrentCount };
  }


  // Track when user stops watching

  async stopWatching(contentId: string, userId: string) {
    const viewers = this.activeViewers.get(contentId);
    
    if (viewers) {
      viewers.delete(userId);
      const concurrentCount = viewers.size;
      
      this.logger.log(`User ${userId} stopped watching ${contentId} (${concurrentCount} remaining)`);
      
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
                lastName: true,
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
    const concurrentViewers = content.contentType === 'LIVE_STREAM' 
      ? this.getActiveViewerCount(id)
      : 0;

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
    return contents.map(content => ({
      ...content,
      concurrentViewers: content.contentType === 'LIVE_STREAM' 
        ? this.getActiveViewerCount(content.id)
        : 0,
    }));
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

    return {
      contentId: content.id,
      title: content.title,
      totalViews: content.views,
      concurrentViewers,
      contentType: content.contentType,
      createdAt: content.createdAt,
    };
  }


  // Cleanup: Remove inactive viewers (run periodically)

  cleanupInactiveViewers() {
    let cleaned = 0;
    
    for (const [contentId, viewers] of this.activeViewers.entries()) {
      if (viewers.size === 0) {
        this.activeViewers.delete(contentId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} empty viewer sets`);
    }
  }
}