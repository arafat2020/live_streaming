import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ChannelService } from './channel.service';
import { MediaServerService } from '../video/media-server.service';
import { VideoService } from '../video/video.service';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { GetMe } from '../user/dto/request-with-user.interface';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetChannelsDto } from './dto/get-channels-query.dto';
import { TermsAcceptedGuard } from 'src/common/guards/terms-accepted.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetRecommendedChannelsDto } from './dto/get-recommended-channels.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Channel Management')
@Controller('channel')
export class ChannelManagementController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly mediaServerService: MediaServerService,
    private readonly videoService: VideoService,
  ) {}

  @ApiOperation({ summary: 'Get real-time stats for my live stream' })
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles('CREATOR', 'ADMIN', 'USER', 'MODERATOR')
  @Get('my-live-stats')
  async getMyLiveStats(@Req() req: GetMe, @Res() res: Response) {
    const userId = req.user.id;
    const channel = await this.channelService.getPrivateChannel(userId);

    const dbStats = await this.videoService.getStreamStats(channel.streamKey);
    const rtStats = this.mediaServerService.getStreamStats(channel.streamKey);

    // Low latency playback URL directly from media server
    const internalPlaybackUrl = this.mediaServerService.getStreamUrl(
      channel.streamKey,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Live stats retrieved successfully.',
      data: {
        isLive: rtStats?.isActive || channel.isLive || false,
        totalViews: channel.statistics?.totalViews || 0,
        followerCount: channel.statistics?.totalFollowers || 0,
        currentStream: dbStats?.currentStream
          ? {
              ...dbStats.currentStream,
              internalPlaybackUrl, // Faster fallback for creator studio
            }
          : null,
        realtime: rtStats || { isActive: false },
        // Flatten some useful fields
        uptime: rtStats?.uptime || 0,
        contentId: dbStats?.currentStream?.id || rtStats?.contentId || null,
      },
    });
  }

  @ApiOperation({
    summary: 'Get all content for the logged-in creator channel',
  })
  @UseGuards(AuthGuard('jwt'), RolesGuard, TermsAcceptedGuard)
  @Roles('CREATOR', 'ADMIN', 'USER', 'MODERATOR')
  @Get('my-content')
  async getMyContent(
    @Req() req: GetMe,
    @Query() paginationDto: PaginationDto,
    @Res() res: Response,
  ) {
    const userId = req.user.id;

    // Find channel for this user
    const channel = await this.channelService.getPrivateChannel(userId);

    const pageNumber = paginationDto.page || 1;
    const limitNumber = paginationDto.limit || 10;

    const result = await this.channelService.getContentByChannelId(
      channel.id,
      pageNumber,
      limitNumber,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'My content retrieved successfully.',
      data: result,
    });
  }

  // @ApiTags('Channels')
  //@UseGuards(AuthGuard('jwt'), RolesGuard,TermsAcceptedGuard)
  @Get('channels')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get all channels with optional search and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Channels retrieved successfully',
  })
  async getChannels(@Query() dto: GetChannelsDto, @Res() res: Response) {
    const result = await this.channelService.getChannels(dto);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Channels retrieved successfully.',
      data: {
        data: result.data,
        meta: result.meta,
      },
    });
  }

  // @UseGuards(AuthGuard('jwt'), RolesGuard,TermsAcceptedGuard)
  @Get('recommendedChannels')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get Recommended Channels' })
  @ApiResponse({
    status: 200,
    description: 'Channels retrieved successfully',
  })
  async getRecommendedChannels(
    @Req() req: { user?: { id?: string } },
    @Query() dto: GetRecommendedChannelsDto,
    @Res() res: Response,
  ) {
    const userId = req.user?.id ?? null;
    const result = await this.channelService.getRecommendedChannels(
      userId,
      dto.limit,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Channels retrieved successfully.',
      data: result,
    });
  }
  /*** GET /creator/channel - Retrieves the private channel details, including streamKey.*/
  @ApiOperation({
    summary:
      'My Chennel. Retrieves the private channel details Calculate total views across all channel content',
  })
  @UseGuards(AuthGuard('jwt'), RolesGuard, TermsAcceptedGuard)
  @Roles('CREATOR', 'ADMIN', 'USER', 'MODERATOR')
  @Get('my-chennel')
  async getPrivateChannel(@Req() req: GetMe, @Res() res: Response) {
    const userId = req.user.id;
    const data = await this.channelService.getPrivateChannel(userId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Retrieves the private channel details successfully.',
      data,
    });
  }

  /**PATCH /creator/channel - Updates channel metadata (name, description, handle).*/
  @UseGuards(AuthGuard('jwt'), RolesGuard, TermsAcceptedGuard)
  @Roles('CREATOR', 'ADMIN', 'USER', 'MODERATOR')
  @Patch()
  async updateChannel(
    @Req() req: GetMe,
    @Body() body: UpdateChannelDto,
    @Res() res: Response,
  ) {
    const userId = req.user.id;
    const data = await this.channelService.updateChannel(userId, body);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Updates channel metadata successfully.',
      data,
    });
  }

  /**POST /creator/channel/key/rotate - Generates a new stream key.*/
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles('CREATOR', 'ADMIN', 'USER', 'MODERATOR')
  @Post('key/rotate')
  @HttpCode(200)
  async rotateStreamKey(@Req() req: GetMe, @Res() res: Response) {
    const userId = req.user.id;
    const data = await this.channelService.rotateStreamKey(userId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Generates a new stream key successfully.',
      data,
    });
  }

  @ApiOperation({ summary: 'Get channel by username' })
  @Get('by-username/:username')
  @HttpCode(200)
  async getChannelByUsername(
    @Param('username') username: string,
    @Res() res: Response,
  ) {
    const data = await this.channelService.getChannelByUsername(username);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Channel retrieved successfully.',
      data,
    });
  }

  // Controller
  @Get('/by-content/:contentId')
  @ApiOperation({
    summary: 'Get contents by channel ID with pagination.',
    description:
      'This endpoint returns the contents associated with a specific channel ID with pagination support.',
  })
  async getChannelByContent(
    @Param('contentId') contentId: string, // ✅ Added missing @Param
    @Query() paginationDto: PaginationDto,
    @Res() res: Response,
  ) {
    // ✅ Use paginationDto instance, not the class
    const pageNumber = paginationDto.page || 1;
    const limitNumber = paginationDto.limit || 10;

    const data = await this.channelService.getContentByChannelId(
      contentId,
      pageNumber,
      limitNumber,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content retrieved successfully.',
      data: data, // ✅ Return contents array
    });
  }

  @ApiOperation({
    summary:
      'Retrieves the Signle channel details Calculate total views across all channel content',
  })
  // @UseGuards(JwtAuthGuard,TermsAcceptedGuard)
  @Get(':id')
  @HttpCode(200)
  async getChannelById(@Param('id') id: string, @Res() res: Response) {
    const data = await this.channelService.getChannelById(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Channel retrieved successfully.',
      data,
    });
  }
}
