import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryContentDto } from './dto/query-content.dto';

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

    const where: any = {};
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    
    // ভিডিও লিস্টে শুধুমাত্র 'READY' ভিডিও দেখানোই ভালো
    if (query.status) {
        where.status = query.status;
    } else {
        where.status = 'READY'; // ডিফল্টভাবে শুধু রেডি ভিডিও
    }

    if (query.contentType) where.contentType = query.contentType;
    if (query.channelId) where.channelId = query.channelId;

    const [items, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { id: true, name: true, handle: true } },
        },
      }),
      this.prisma.content.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
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
