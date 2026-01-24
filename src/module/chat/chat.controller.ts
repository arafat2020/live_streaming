import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { ChatGateway } from './chat.gateway'; // import gateway type
import { ChatService } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateChatDto } from './dto/update-chat.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway, // inject gateway
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a chat room' })
  async create(@Body() dto: CreateChatDto, @Res() res: Response) {
    const data = await this.chatService.create(dto);

    // Emit socket event: new room created
    try {
      this.chatGateway.server?.emit('roomCreated', { room: data });
    } catch (e) {
      // log but don't fail the request
      console.error('Failed to emit roomCreated', e);
    }

    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Chat created successfully.',
      data,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all chat rooms' })
  async findAll(@Res() res: Response) {
    const data = await this.chatService.findAll();
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Chat retrieve successfully.',
      data,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a chat room by ID' })
  async findOne(@Param('id') id: string, @Res() res: Response) {
    const data = await this.chatService.findOne(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Chat retrieve successfully.',
      data,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a chat room' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChatDto,
    @Res() res: Response,
  ) {
    const data = await this.chatService.update(id, dto);

    // Emit socket event: room updated (e.g., isActive toggled)
    try {
      // If room has participants/roomId, broadcast to that room
      this.chatGateway.server?.to(id).emit('roomUpdated', { room: data });
      // also emit global update
      this.chatGateway.server?.emit('roomUpdated:global', { room: data });
    } catch (e) {
      console.error('Failed to emit roomUpdated', e);
    }

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Chat updated successfully.',
      data,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a chat room' })
  async remove(@Param('id') id: string, @Res() res: Response) {
    const data = await this.chatService.remove(id);

    // Emit socket event: room deleted
    try {
      this.chatGateway.server?.to(id).emit('roomDeleted', { roomId: id });
      this.chatGateway.server?.emit('roomDeleted:global', { roomId: id });
    } catch (e) {
      console.error('Failed to emit roomDeleted', e);
    }

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Chat deleted successfully.',
      data,
    });
  }

  @Post(':id/participants')
  @ApiOperation({ summary: 'Add a participant to chat room' })
  async addParticipant(
    @Param('id') roomId: string,
    @Body() dto: CreateParticipantDto,
    @Res() res: Response,
  ) {
    const data = await this.chatService.addParticipant(roomId, dto.userId);

    // Emit socket event: participant joined the room
    try {
      this.chatGateway.server
        ?.to(roomId)
        .emit('participantJoined', { participant: data });
      // also emit to the specific user socket if you track socket ids by user:
      // this.chatGateway.server.to(socketId).emit('direct:participantJoined', {...})
    } catch (e) {
      console.error('Failed to emit participantJoined', e);
    }

    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Chat Participant Added successfully.',
      data,
    });
  }

  @Delete('participants/:participantId')
  @ApiOperation({ summary: 'Remove a participant from chat room' })
  async removeParticipant(
    @Param('participantId') participantId: string,
    @Res() res: Response,
  ) {
    // Look up participant to get its roomId & userId for broadcasting
    // Better to fetch before deletion so we can emit meaningful event
    let participantRecord;
    try {
      participantRecord =
        await this.chatService.removeParticipant(participantId);
      // participantRecord contains the deleted record (Prisma returns it)
    } catch (err) {
      // If removal failed, let service throw exception
      throw err;
    }

    try {
      const roomId = participantRecord.roomId;
      const userId = participantRecord.userId;
      this.chatGateway.server?.to(roomId).emit('participantLeft', {
        participantId,
        userId,
      });
    } catch (e) {
      console.error('Failed to emit participantLeft', e);
    }

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Chat Participant deleted successfully.',
      data: participantRecord,
    });
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message in a chat room' })
  async sendMessage(
    @Param('id') roomId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const data = await this.chatService.sendMessage(
      roomId,
      dto.userId,
      dto.content,
    );

    // Emit socket event: new message in the room
    try {
      this.chatGateway.server?.to(roomId).emit('message', { message: data });
      // Optionally emit ack channel or per-user
      this.chatGateway.server?.emit('message:global', { message: data });
    } catch (e) {
      console.error('Failed to emit message', e);
    }

    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Chat message created successfully.',
      data,
    });
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get all messages of a chat room' })
  async getMessages(@Param('id') roomId: string, @Res() res: Response) {
    const data = await this.chatService.getMessages(roomId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Messages retrieve successfully.',
      data,
    });
  }
}
