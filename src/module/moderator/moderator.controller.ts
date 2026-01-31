import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetMe } from '../user/dto/request-with-user.interface';
import sendResponse from '../utils/sendResponse';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { HandleAppealDto } from './dto/handle-appeal.dto';
import { ModeratorBanUserDto } from './dto/moderator-ban-user.dto';
import { SubmitAppealDto } from './dto/submit-appeal.dto';
import { ModeratorService } from './moderator.service';
@Controller('moderator')
export class ModeratorController {
  constructor(private readonly moderatorService: ModeratorService) {}

  async verifyChannelOwner(channelId: string, userId: string) {
    const channel = await this.moderatorService['prisma'].channel.findUnique({
      where: { id: channelId },
      select: { ownerId: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can ban users');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Body() createModeratorDto: CreateModeratorDto,
    @Req() req: GetMe,
  ) {
    return this.moderatorService.create(createModeratorDto, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.moderatorService.findAll();
  }
  @UseGuards(JwtAuthGuard)
  @Get('ban/check')
  async checkUserBan(
    @Query('channelId') channelId: string,
    @Query('userId') userId: string,
  ) {
    return this.moderatorService.checkUserBan(channelId, userId);
  }
  @UseGuards(JwtAuthGuard)
  @Get('channel/:channelId')
  findByChannel(@Param('channelId') channelId: string) {
    return this.moderatorService.findByChannel(channelId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.moderatorService.findByUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('check')
  async checkIsModerator(
    @Query('userId') userId: string,
    @Query('channelId') channelId: string,
    @Res() res: Response,
  ) {
    if (!userId || !channelId) {
      throw new BadRequestException('User ID and Channel ID are required');
    }

    const isModerator = await this.moderatorService.checkIsModerator(
      userId,
      channelId,
    );
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Moderator status checked successfully',
      data: isModerator,
    });
  }

  @ApiOperation({
    summary: 'Search users to manage (only for channel moderators/owners)',
  })
  @UseGuards(JwtAuthGuard)
  @Get('search-users')
  async searchUsers(
    @Query('channelId') channelId: string,
    @Query('q') query: string,
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    if (!channelId) {
      throw new BadRequestException('Channel ID is required');
    }

    const userId = req.user.id;
    const searchQuery = query || '';
    const data = await this.moderatorService.searchUsersForModeration(
      channelId,
      searchQuery,
      userId,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Users retrieved successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'Allows only MODERATOR and owner can perform' })
  @UseGuards(JwtAuthGuard)
  @Post('ban/:channelId')
  async banUser(
    @Param('channelId') channelId: string,
    @Body() dto: ModeratorBanUserDto,
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    const userId = req.user.id;
    const user = req.user;
    //console.log("user---------->",user?.channel?.id)
    const checkIsModerator = await this.moderatorService.checkIsModerator(
      userId,
      channelId,
    );
    if (checkIsModerator || user?.channel?.id === channelId) {
      const data = await this.moderatorService.banUser(channelId, dto, userId);

      return sendResponse(res, {
        statusCode: HttpStatus.CREATED,
        success: true,
        message: 'User banned successfully',
        data,
      });
    }
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: false,
      message: 'You are not this channel Moderator',
      data: null,
    });
    //await this.verifyChannelOwner(channelId, userId);
  }

  @ApiOperation({ summary: 'Unban a user from the channel' })
  @UseGuards(JwtAuthGuard)
  @Post('unban/:channelId/:userId')
  async unbanUser(
    @Param('channelId') channelId: string,
    @Param('userId') userId: string,
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    const requesterId = req.user.id;
    const data = await this.moderatorService.unbanUser(
      channelId,
      userId,
      requesterId,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User unbanned successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'List all banned users in a channel' })
  @UseGuards(JwtAuthGuard)
  @Get('banned-list/:channelId')
  async getBannedUsers(
    @Param('channelId') channelId: string,
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    const requesterId = req.user.id;
    const data = await this.moderatorService.getBannedUsers(
      channelId,
      requesterId,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Banned users retrieved successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'Submit an unban appeal' })
  @UseGuards(JwtAuthGuard)
  @Post('appeal')
  async submitAppeal(
    @Req() req: GetMe,
    @Body() dto: SubmitAppealDto,
    @Res() res: Response,
  ) {
    const userId = req.user.id;
    const data = await this.moderatorService.submitAppeal(userId, dto);

    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Appeal submitted successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'Get all appeals for a channel (Moderator only)' })
  @UseGuards(JwtAuthGuard)
  @Get('appeals/:channelId')
  async getAppeals(
    @Param('channelId') channelId: string,
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    const requesterId = req.user.id;
    const data = await this.moderatorService.getAppeals(channelId, requesterId);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Appeals retrieved successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'Handle an unban appeal (Moderator only)' })
  @UseGuards(JwtAuthGuard)
  @Patch('appeals/:appealId')
  async handleAppeal(
    @Param('appealId') appealId: string,
    @Body() dto: HandleAppealDto,
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    const requesterId = req.user.id;
    const data = await this.moderatorService.handleAppeal(
      appealId,
      dto,
      requesterId,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Appeal handled successfully',
      data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: GetMe) {
    return this.moderatorService.remove(id, req.user.id);
  }
}
