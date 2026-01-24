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
} from '@nestjs/common';

import { Response } from 'express';
import sendResponse from '../utils/sendResponse';
// import { NotificationType } from '@prisma/client';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // @Post()
  // async create(@Body() dto: CreateNotificationDto, @Res() res: Response) {
  //   const data = await this.notificationService.create({
  //     user: { connect: { id: dto.userId } },
  //     type: dto.type ?? 'ANNOUNCEMENT',
  //     message: dto.message,
  //     contentId: dto.contentId ?? null,
  //   });
  //   // fire-and-forget broadcast for announcement - if you want guaranteed, call sendNotification
  //   this.notificationService
  //     .sendNotification(dto.userId, dto.type ?? ('ANNOUNCEMENT' as NotificationType), dto.message, dto.contentId ?? null)
  //     .catch((err) => console.error('broadcast error', err));
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.CREATED,
  //     success: true,
  //     message: 'Notification created successfully.',
  //     data,
  //   });
  // }
  @Post()
  async create(@Body() dto: CreateNotificationDto, @Res() res: Response) {
    const notification = await this.notificationService.create({
      user: { connect: { id: dto.userId } },
      type: dto.type ?? 'ANNOUNCEMENT',
      message: dto.message,
      contentId: dto.contentId ?? null,
    });

    // const emitted = await this.notificationService.sendNotification(
    //   dto.userId,
    //   dto.type ?? ('ANNOUNCEMENT' as NotificationType),
    //   dto.message,
    //   dto.contentId ?? null
    // );

    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Notification created and delivered successfully',
      data: { notification },
    });
  }

  @Get()
  async findAll(@Res() res: Response, @Query('userId') userId?: string) {
    const data = await this.notificationService.findAll(userId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Notifications retrieved successfully.',
      data,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Res() res: Response) {
    const data = await this.notificationService.findOne(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Notification with ID ${id} retrieved successfully.`,
      data,
    });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationDto,
    @Res() res: Response,
  ) {
    const data = await this.notificationService.update(id, dto as any);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Notification with ID ${id} updated successfully.`,
      data,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Res() res: Response) {
    const data = await this.notificationService.remove(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Notification with ID ${id} deleted successfully.`,
      data,
    });
  }
}
