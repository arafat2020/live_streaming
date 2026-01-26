import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { safeChannelSelect } from '../channel/dto/safeChannelSelect';
import { publicUserSelect } from '../user/dto/publicUserSelect';
import { safeUserSelect } from '../user/dto/safeUserSelect';
import { ChatGateway } from './chat.gateway';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private gateway: ChatGateway,
  ) {}

  async create(createChatDto: CreateChatDto) {
    try {
      return await this.prisma.chatRoom.create({ data: createChatDto });
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        error.message || 'Failed to create chat room',
      );
    }
  }

  async findAll() {
    try {
      return await this.prisma.chatRoom.findMany({
        include: {
          participants: {
            include: {
              user: { select: publicUserSelect },
            },
          },
          chatMessage: {
            include: {
              user: { select: publicUserSelect },
            },
          },
          channel: { select: safeChannelSelect },
        },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to fetch chat rooms');
    }
  }

  async findOne(id: string) {
    if (!id) throw new BadRequestException('ID is required');
    try {
      const room = await this.prisma.chatRoom.findUnique({
        where: { id },
        include: {
          participants: {
            include: {
              user: { select: safeUserSelect },
            },
          },
          chatMessage: {
            include: {
              user: { select: safeUserSelect },
            },
          },
          channel: { select: safeChannelSelect },
        },
      });
      if (!room) throw new NotFoundException(`ChatRoom ${id} not found`);
      return room;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to fetch chat room');
    }
  }

  async update(id: string, updateChatDto: UpdateChatDto) {
    if (!id) throw new BadRequestException('ID is required');
    try {
      return await this.prisma.chatRoom.update({
        where: { id },
        data: updateChatDto,
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to update chat room');
    }
  }

  async remove(id: string) {
    if (!id) throw new BadRequestException('ID is required');
    try {
      await this.prisma.chatRoom.delete({ where: { id } });
      return { message: `ChatRoom ${id} deleted` };
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to delete chat room');
    }
  }

  async addParticipant(roomId: string, userId: string) {
    if (!roomId || !userId)
      throw new BadRequestException('roomId and userId are required');

    // Check existence
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
    });
    if (!room) throw new NotFoundException(`ChatRoom ${roomId} not found`);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    try {
      return await this.prisma.chatParticipant.create({
        data: { roomId, userId },
        select: {
          id: true,
          roomId: true,
          userId: true,
          user: { select: publicUserSelect },
        },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to add participant');
    }
  }

  async removeParticipant(participantId: string) {
    if (!participantId)
      throw new BadRequestException('participantId is required');
    try {
      return await this.prisma.chatParticipant.delete({
        where: { id: participantId },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to remove participant');
    }
  }

  async sendMessage(
    roomId: string,
    userId: string,
    content: string,
    replyToId?: string,
  ) {
    if (!roomId || !userId || !content)
      throw new BadRequestException('roomId, userId, and content are required');

    // Optional: validate room & user exist
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
    });
    if (!room) throw new NotFoundException(`ChatRoom ${roomId} not found`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    // Check account age (15 minutes requirement)
    const accountAgeMinutes = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (1000 * 60),
    );
    if (accountAgeMinutes < 15) {
      throw new ForbiddenException(
        `New accounts must wait 15 minutes before chatting. Please try again in ${15 - accountAgeMinutes} minutes.`,
      );
    }

    try {
      return await this.prisma.chatMessage.create({
        data: { roomId, userId, content, replyToId },
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
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to send message');
    }
  }

  async getMessages(roomId: string) {
    if (!roomId) throw new BadRequestException('roomId is required');
    try {
      const messages = await this.prisma.chatMessage.findMany({
        where: { roomId },
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
        take: 50, // Added a reasonable limit since it was missing
      });
      return messages;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to fetch messages');
    }
  }
}
