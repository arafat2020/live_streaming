import {
  Controller,
  Post,
  Body,
  Res,
  Get,
  Query,
  Param,
  Patch,
  Delete,
  HttpStatus,
  UseGuards,
  Req,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Response } from 'express';
import sendResponse from '../utils/sendResponse';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestWithUser } from '../user/dto/request-with-user.interface';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateNotificationDto,
    @Res() res: Response,
  ) {
    // Security: Users can only create notifications for themselves
    // Admins can create for anyone
    const requesterId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isAdmin && dto.userId !== requesterId) {
      throw new ForbiddenException(
        'You can only create notifications for yourself',
      );
    }

    const notification = await this.notificationService.create({
      user: { connect: { id: dto.userId } },
      type: dto.type ?? 'ANNOUNCEMENT',
      message: dto.message,
      contentId: dto.contentId ?? null,
    });

    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Notification created and delivered successfully',
      data: { notification },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(
    @Req() req: RequestWithUser,
    @Res() res: Response,
    @Query('userId') userId?: string,
  ) {
    // Users can only see their own notifications
    // Admins can see all
    const requesterId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    const targetUserId = userId || requesterId;

    if (!isAdmin && targetUserId !== requesterId) {
      throw new ForbiddenException('You can only view your own notifications');
    }

    const data = await this.notificationService.findAll(targetUserId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Notifications retrieved successfully.',
      data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const notification = await this.notificationService.findOne(id);

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // Check ownership
    const requesterId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isAdmin && notification.userId !== requesterId) {
      throw new ForbiddenException('You can only view your own notifications');
    }

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Notification with ID ${id} retrieved successfully.`,
      data: notification,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateNotificationDto,
    @Res() res: Response,
  ) {
    const notification = await this.notificationService.findOne(id);

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // Check ownership
    const requesterId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isAdmin && notification.userId !== requesterId) {
      throw new ForbiddenException(
        'You can only update your own notifications',
      );
    }

    const data = await this.notificationService.update(id, dto as any);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Notification with ID ${id} updated successfully.`,
      data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const notification = await this.notificationService.findOne(id);

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // Check ownership
    const requesterId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isAdmin && notification.userId !== requesterId) {
      throw new ForbiddenException(
        'You can only delete your own notifications',
      );
    }

    const data = await this.notificationService.remove(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Notification with ID ${id} deleted successfully.`,
      data,
    });
  }
}
