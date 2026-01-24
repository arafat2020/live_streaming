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
import { NotificationService } from '../notification/notification.service';
import { CreateUserNotificationPreferenceDto } from './dto/create-user-notification-preference.dto';
import { UpdateUserNotificationPreferenceDto } from './dto/update-user-notification-preference.dto';
import { UserNotificationPreferenceService } from './user-notification-preference.service';

@ApiTags('User Notification Preferences')
@Controller('user-notification-preference')
export class UserNotificationPreferenceController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly userNotificationPreferenceService: UserNotificationPreferenceService,
  ) {}

  @Post(':userId')
  @ApiOperation({
    summary: 'Create user notification preferences for a specific user',
  })
  async create(
    @Param('userId') userId: string,
    @Body() dto: CreateUserNotificationPreferenceDto,
    @Res() res: Response,
  ) {
    const data = await this.userNotificationPreferenceService.create(
      userId,
      dto,
    );
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'User notification preferences created successfully.',
      data,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Retrieve all user notification preferences' })
  async findAll(@Res() res: Response) {
    const data = await this.userNotificationPreferenceService.findAll();
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'All user notification preferences retrieved successfully.',
      data,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve a single user notification preference by ID',
  })
  async findOne(@Param('id') id: string, @Res() res: Response) {
    const data = await this.userNotificationPreferenceService.findOne(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `User notification preference with ID ${id} retrieved successfully.`,
      data,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user notification preference by ID' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateUserNotificationPreferenceDto,
    @Res() res: Response,
  ) {
    const data = await this.userNotificationPreferenceService.update(
      id,
      updateDto,
    );
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `User notification preference with ID ${id} updated successfully.`,
      data,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user notification preference by ID' })
  async remove(@Param('id') id: string, @Res() res: Response) {
    const data = await this.userNotificationPreferenceService.remove(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `User notification preference with ID ${id} deleted successfully.`,
      data,
    });
  }
}
