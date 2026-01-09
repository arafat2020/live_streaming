import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ChannelService } from './channel.service';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { CreateChannelDto } from './dto/create-channel.dto';
import { GetMe } from '../user/dto/request-with-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BanUserDto, UnbanUserDto } from './dto/ban-user.dto';
import { PrismaService } from 'src/prisma/prisma.service';


@Controller('channels/:channelId')
@UseGuards(JwtAuthGuard)
export class ChannelController {
  constructor(private readonly channelService: ChannelService,private prisma: PrismaService) {}

  @Post('ban')
  async banUser(
    @Param('channelId') channelId: string,
    @Body() dto: BanUserDto,
    @Req() req: GetMe,
    @Res() res: Response
  ) {
    const userId = req.user.id; 
    // Verify user is channel owner
    await this.verifyChannelOwner(channelId, userId);
    
    const data =await this.channelService.banUser(channelId, dto, userId);
      return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'User ban successfully.',
      data: data,
    });
  }


  @Delete('unban')
  async unbanUser(
    @Param('channelId') channelId: string,
    @Body() dto: UnbanUserDto,
    @Req() req: GetMe,
    @Res() res: Response
  ) {
     const userId = req.user.id; 
    await this.verifyChannelOwner(channelId, userId);
    
    const data =await this.channelService.unbanUser(channelId, dto.userId);
      return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User unbanned successfully.',
      data: data,
    });
  }

 
  @Get('bans')
  async getBannedUsers(
    @Param('channelId') channelId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe)
    page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe)
    pageSize: number,
    @Req() req: GetMe,
    @Res() res: Response
  ) {
     const userId = req.user.id; 
    await this.verifyChannelOwner(channelId, userId);
    
    const data = await this.channelService.getBannedUsers(channelId, page, pageSize);
      return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Banned users fetched successfully.',
      data: data,
    });
  }

  private async verifyChannelOwner(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel || channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can moderate');
    }
  }
  
}