import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryContentDto ,ContentSortBy} from './dto/query-content.dto';

@Injectable()
export class ContentService {
  constructor(private prisma: PrismaService) {}

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

  async findAll(query: QueryContentDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy;
    const title = query.title;

    const skip = (page - 1) * pageSize;

    // Determine sorting - default to most recent if not provided
    const orderBy = sortBy === ContentSortBy.MOST_VIEWED
      ? { views: 'desc' as const }
      : { createdAt: 'desc' as const };

    // Build where clause for filtering
    const where = title
      ? {
          title: {
            contains: title,
            mode: 'insensitive' as const,
          },
        }
      : {};

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
      },
    };
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

  async remove(id: string) {
    // you may want soft-delete instead depending on requirements
    await this.findOne(id);
    await this.prisma.content.delete({ where: { id } });
    return { success: true };
  }
  // optional: increment view count safely
  async incrementViews(id: string) {
    const updated = await this.prisma.content.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { id: true, views: true },
    });
    return updated;
  }
}
