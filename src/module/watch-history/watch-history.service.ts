import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateWatchHistoryDto } from './dto/create-watch-history.dto';
import { UpdateWatchHistoryDto } from './dto/update-watch-history.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryWatchHistoryDto } from './dto/query-watch-history.dto';
import { Prisma } from '@prisma/client';
import { ContentService } from '../content/content.service';

@Injectable()
export class WatchHistoryService {
  private readonly logger = new Logger(ContentService.name);
  constructor(private prisma: PrismaService) {}

   // Increment view count for content
   
  async incrementViews(contentId: string) {
    this.logger.log(`Incrementing view count for content ${contentId}`);

    // Check if content exists
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        title: true,
        views: true,
      },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    // Increment view count
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
      },
    });

    this.logger.log(
      `View count incremented for content ${contentId}: ${content.views} → ${updated.views}`,
    );

    return {
      success: true,
      contentId: updated.id,
      views: updated.views,
    };
  }

 
   // Get content with view count
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

    return content;
  }

   // Get top viewed content

  async getTopViewed(limit = 10) {
    return this.prisma.content.findMany({
      // where: {
      //   status: 'AVAILABLE',
      // },
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
  }


}
