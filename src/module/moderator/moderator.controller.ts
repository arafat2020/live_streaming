import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, Res, HttpStatus, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ModeratorService } from './moderator.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { UpdateModeratorDto } from './dto/update-moderator.dto';
import { GetMe } from '../user/dto/request-with-user.interface';
import sendResponse from '../utils/sendResponse';
import { Request, Response } from 'express';
import { BanUserDto } from './dto/ban-user.dto';
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
  @Post()
  create(@Body() createModeratorDto: CreateModeratorDto) {
    return this.moderatorService.create(createModeratorDto);
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
  @Get('channel/:channelId')
  findByChannel(@Param('channelId') channelId: string) {
    return this.moderatorService.findByChannel(channelId);
  }

  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.moderatorService.findByUser(userId);
  }

  @Get('check')
  checkIsModerator(
    @Query('userId') userId: string,
    @Query('channelId') channelId: string,
  ) {
    return this.moderatorService.checkIsModerator(userId, channelId);
  }
  
@Post('ban/:channelId')
async banUser(
  @Param('channelId') channelId: string,
  @Body() dto: BanUserDto,
  @Req() req: GetMe,
  @Res() res: Response
) {
  const userId = req.user.id;

  await this.verifyChannelOwner(channelId, userId);

  const data = await this.moderatorService.banUser(channelId, dto, userId);

  return sendResponse(res, {
    statusCode: HttpStatus.CREATED,
    success: true,
    message: 'User banned successfully',
    data,
  });
}


  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.moderatorService.remove(id);
  }


}
