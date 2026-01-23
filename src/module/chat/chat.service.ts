import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateChatDto } from './dto/create-chat.dto';
import { UpdateChatDto } from './dto/update-chat.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { safeUserSelect } from '../user/dto/safeUserSelect';
import { safeChannelSelect } from '../channel/dto/safeChannelSelect';

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private gateway: ChatGateway,
  ) { }

  async create(createChatDto: CreateChatDto) {
    try {
      return await this.prisma.chatRoom.create({ data: createChatDto });
    } catch (error) {
      console.error(error);
      throw new BadRequestException(error.message || 'Failed to create chat room');
    }
  }

  async findAll() {
    try {
      return await this.prisma.chatRoom.findMany({
        include: {
          participants: {
            include: {
              user: { select: safeUserSelect }
            }
          },
          chatMessage: {
            include: {
              user: { select: safeUserSelect }
            }
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
              user: { select: safeUserSelect }
            }
          },
          chatMessage: {
            include: {
              user: { select: safeUserSelect }
            }
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
      return await this.prisma.chatRoom.update({ where: { id }, data: updateChatDto });
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
    if (!roomId || !userId) throw new BadRequestException('roomId and userId are required');

    // Check existence
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`ChatRoom ${roomId} not found`);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    try {
      return await this.prisma.chatParticipant.create({
        data: { roomId, userId },
        include: { user: true },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to add participant');
    }
  }

  async removeParticipant(participantId: string) {
    if (!participantId) throw new BadRequestException('participantId is required');
    try {
      return await this.prisma.chatParticipant.delete({ where: { id: participantId } });
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Failed to remove participant');
    }
  }

  async sendMessage(roomId: string, userId: string, content: string) {
    if (!roomId || !userId || !content)
      throw new BadRequestException('roomId, userId, and content are required');

    // Optional: validate room & user exist
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`ChatRoom ${roomId} not found`);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    try {
      return await this.prisma.chatMessage.create({
        data: { roomId, userId, content },
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