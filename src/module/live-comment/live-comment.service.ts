import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LiveCommentGateway } from './liveComment.gateway';
import { CreateLiveCommentDto } from './dto/create-live-comment.dto';
import { UpdateLiveCommentDto } from './dto/update-live-comment.dto';
import { ModeratorService } from '../moderator/moderator.service';

@Injectable()
export class LiveCommentService {
  constructor(
    private prisma: PrismaService,
    private gateway: LiveCommentGateway,
    private moderatorService: ModeratorService,
  ) { }

  // ------- GET ALL COMMENTS FOR VIDEO -------
  async getAll(videoId: string, paginationQuery?: { page?: number; limit?: number }) {
    const page = paginationQuery?.page || 1;
    const limit = paginationQuery?.limit || 20;
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const totalCount = await this.prisma.liveComment.count({
      where: { videoId },
    });

    // Fetch paginated comments
    const comments = await this.prisma.liveComment.findMany({
      where: { videoId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profileImage: true,
            chatColor: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }, // Get newest first for pagination
      skip,
      take: limit,
    });

    // Add userRole to each comment
    const commentsWithRoles = await Promise.all(
      comments.map(async (comment) => {
        const userRole = await this.getUserRole(comment.userId, videoId);
        return {
          ...comment,
          userRole,
        };
      })
    );

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      data: commentsWithRoles,
      meta: {
        total: totalCount,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    };
  }

  // ------- CREATE COMMENT -------
  async create(userId: string, dto: CreateLiveCommentDto) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const comment = await this.prisma.liveComment.create({
      data: { userId, ...dto },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profileImage: true,
            chatColor: true,
          }
        }
      },
    });

    // Determine user role for this video/stream
    const userRole = await this.getUserRole(userId, dto.videoId);

    // Add role to comment object before broadcasting
    const commentWithRole = {
      ...comment,
      userRole,
    };

    // Send realtime event with role information
    this.gateway.sendCreate(dto.videoId, commentWithRole);

    return commentWithRole;
  }

  // ------- HELPER: Determine User Role -------
  private async getUserRole(userId: string, videoId: string): Promise<'owner' | 'moderator' | 'user'> {
    try {
      // Get the content/video to find the associated channel
      const content = await this.prisma.content.findUnique({
        where: { id: videoId },
        include: { channel: true },
      });

      if (!content || !content.channel) {
        return 'user'; // Default to regular user if content/channel not found
      }

      const channelId = content.channel.id;
      const ownerId = content.channel.ownerId;

      // Check if user is the channel owner
      if (userId === ownerId) {
        return 'owner';
      }

      // Check if user is a moderator
      const isModerator = await this.moderatorService.checkIsModerator(userId, channelId);
      if (isModerator) {
        return 'moderator';
      }

      return 'user';
    } catch (error) {
      console.error('Error determining user role:', error);
      return 'user'; // Default to regular user on error
    }
  }

  // ------- UPDATE COMMENT -------
  async update(id: string, dto: UpdateLiveCommentDto) {
    const comment = await this.prisma.liveComment.update({
      where: { id },
      data: dto,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            profileImage: true,
            chatColor: true,
          }
        }
      },
    });

    this.gateway.sendUpdate(comment.videoId, comment);

    return comment;
  }

  // ------- DELETE COMMENT -------
  async remove(id: string) {
    const comment = await this.prisma.liveComment.findUnique({
      where: { id },
    });
    if (!comment) return null;

    await this.prisma.liveComment.delete({ where: { id } });

    this.gateway.sendDelete(comment.videoId, id);

    return { id };
  }
}
