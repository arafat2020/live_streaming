import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, Res, HttpStatus, NotFoundException, ForbiddenException, UseGuards } from '@nestjs/common';
import { ModeratorService } from './moderator.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { UpdateModeratorDto } from './dto/update-moderator.dto';
import { GetMe } from '../user/dto/request-with-user.interface';
import sendResponse from '../utils/sendResponse';
import { Request, Response } from 'express';
import { ModeratorBanUserDto } from './dto/moderator-ban-user.dto';
import { ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';
@Controller('moderator')
export class ModeratorController {
  constructor(private readonly moderatorService: ModeratorService) { }

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
  async create(@Body() createModeratorDto: CreateModeratorDto, @Req() req: GetMe) {
    return this.moderatorService.create(createModeratorDto, req.user.id);
  }

  @Get()
  findAll() {
    return this.moderatorService.findAll();
  }
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

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.moderatorService.findByUser(userId);
  }

  @Get('check')
  async checkIsModerator(
    @Query('userId') userId: string,
    @Query('channelId') channelId: string,
    @Res() res: Response,
  ) {
    const isModerator = await this.moderatorService.checkIsModerator(userId, channelId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Moderator status checked successfully',
      data: isModerator,
    });
  }

  @ApiOperation({ summary: 'Search users to manage (only for channel moderators/owners)' })
  @UseGuards(JwtAuthGuard)
  @Get('search-users')
  async searchUsers(
    @Query('channelId') channelId: string,
    @Query('q') query: string,
    @Req() req: GetMe,
    @Res() res: Response
  ) {
    const userId = req.user.id;
    const data = await this.moderatorService.searchUsersForModeration(channelId, query, userId);

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
    @Res() res: Response
  ) {
    const userId = req.user.id;
    const user = req.user;
    //console.log("user---------->",user?.channel?.id)
    const checkIsModerator = await this.moderatorService.checkIsModerator(userId, channelId);
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
      data: null
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
    @Res() res: Response
  ) {
    const requesterId = req.user.id;
    const data = await this.moderatorService.unbanUser(channelId, userId, requesterId);

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
    @Res() res: Response
  ) {
    const requesterId = req.user.id;
    const data = await this.moderatorService.getBannedUsers(channelId, requesterId);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Banned users retrieved successfully',
      data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: GetMe) {
    return this.moderatorService.remove(id, req.user.id);
  }
}
