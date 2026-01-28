import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LiveCommentGateway } from './liveComment.gateway';
import { CreateLiveCommentDto } from './dto/create-live-comment.dto';
import { UpdateLiveCommentDto } from './dto/update-live-comment.dto';
import { ModeratorService } from '../moderator/moderator.service';
import { publicUserSelect } from '../user/dto/publicUserSelect';

@Injectable()
export class LiveCommentService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => LiveCommentGateway))
    private gateway: LiveCommentGateway,
    private moderatorService: ModeratorService,
  ) {}

  // ------- GET ALL COMMENTS FOR VIDEO -------
  async getAll(
    videoId: string,
    paginationQuery?: { page?: number; limit?: number },
  ) {
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
          select: publicUserSelect,
        },
        replyTo: {
          include: {
            user: { select: publicUserSelect },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
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
      }),
    );

    // Transform to threaded order
    const threadedData = this.buildThreadedList(commentsWithRoles);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      data: threadedData,
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

  private buildThreadedList(comments: any[]) {
    const map = new Map<string, any>();
    comments.forEach((c) => {
      c.replies = [];
      map.set(c.id, c);
    });

    const roots: any[] = [];
    comments.forEach((c) => {
      if (c.replyToId && map.has(c.replyToId)) {
        map.get(c.replyToId).replies.push(c);
      } else {
        roots.push(c);
      }
    });

    const flatten = (nodes: any[]) => {
      const result: any[] = [];
      nodes.forEach((node) => {
        result.push(node);
        if (node.replies && node.replies.length > 0) {
          // Sort replies by time ASC (natural flow within a thread)
          node.replies.sort(
            (a: any, b: any) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          result.push(...flatten(node.replies));
        }
      });
      return result;
    };

    // Sort roots by time DESC (newest root conversations first)
    roots.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return flatten(roots);
  }

  // ------- CREATE COMMENT -------
  async create(userId: string, dto: CreateLiveCommentDto) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    // 1. Get the content/video to find the associated channel
    const content = await this.prisma.content.findUnique({
      where: { id: dto.videoId },
      include: { channel: true },
    });

    if (!content || !content.channel) {
      throw new BadRequestException('Associated channel not found');
    }

    const channelId = content.channel.id;

    // 2. Check if user is banned from this channel
    const banStatus = await this.moderatorService.checkUserBan(
      channelId,
      userId,
    );
    if (banStatus.isBanned) {
      throw new BadRequestException(
        `You are banned from this channel. Reason: ${banStatus.reason || 'No reason provided'}`,
      );
    }

    // Calculate depth for nesting
    let depth = 0;
    if (dto.replyToId) {
      const parent = await this.prisma.liveComment.findUnique({
        where: { id: dto.replyToId },
        select: { depth: true },
      });
      if (parent) {
        depth = (parent.depth || 0) + 1;
      }
    }

    // Determine user role for this video/stream early to check age gate
    const userRole = await this.getUserRole(userId, dto.videoId);

    // Check account age (15 minutes requirement)
    // EXCEPTION: Channel owner and Moderators can always chat immediately
    if (userRole === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      });

      if (user) {
        const accountAgeMinutes = Math.floor(
          (Date.now() - user.createdAt.getTime()) / (1000 * 60),
        );
        if (accountAgeMinutes < 15) {
          throw new ForbiddenException(
            `New accounts must wait 15 minutes before chatting. Please try again in ${15 - accountAgeMinutes} minutes.`,
          );
        }
      }
    }

    const comment = await this.prisma.liveComment.create({
      data: { userId, ...dto, depth },
      include: {
        user: {
          select: publicUserSelect,
        },
        replyTo: {
          include: {
            user: { select: publicUserSelect },
          },
        },
      },
    });

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
  private async getUserRole(
    userId: string,
    videoId: string,
  ): Promise<'owner' | 'moderator' | 'user'> {
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
      const isModerator = await this.moderatorService.checkIsModerator(
        userId,
        channelId,
      );
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
          select: publicUserSelect,
        },
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
