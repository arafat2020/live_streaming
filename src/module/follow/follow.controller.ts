import {
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestWithUser } from '../user/dto/request-with-user.interface';
import { QueryFollowDto } from './dto/query-follow.dto';
import { FollowService } from './follow.service';

@Controller('follow')
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @ApiOperation({ summary: 'Follow a channel by its channnelId' })
  @UseGuards(JwtAuthGuard)
  @Post(':channnelId')
  async follow(
    @Param('channnelId') channnelId: string,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const data = await this.followService.followChannel(
      req.user.id,
      channnelId,
    );
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Channel followed successfully.',
      data,
    });
  }

  @ApiOperation({
    summary: 'Check if the authenticated user follows this channel',
  })
  @UseGuards(JwtAuthGuard)
  @Get(':channnelId/status')
  async status(
    @Param('channnelId') channnelId: string,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const data = await this.followService.isFollowing(req.user.id, channnelId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Follow status retrieved successfully.',
      data,
    });
  }

  // @ApiOperation({ summary: 'Get all channels the user follows' })
  // @UseGuards(JwtAuthGuard)
  // @Get('/me/list')
  // async getMyFollows(@Req() req: RequestWithUser, @Res() res: Response) {
  //   const data = await this.followService.getFollowedChannels(req.user.id);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'Followed channels retrieved successfully.',
  //     data,
  //   });
  // }
  @ApiOperation({
    summary: 'Get all channels the user follows',
    description: 'Returns paginated list of followed channels with total count',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @UseGuards(JwtAuthGuard)
  @Get('/me/list')
  async getMyFollows(
    @Req() req: RequestWithUser,
    @Query() query: QueryFollowDto,
    @Res() res: Response,
  ) {
    const result = await this.followService.getFollowedChannels(
      req.user.id,
      query,
    );

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Followed channels retrieved successfully.',
      data: {
        data: result.data,
        meta: result.meta,
      },
    });
  }
  @ApiOperation({ summary: 'Get all followers of the specified channel' })
  @Get(':channnelId/followers')
  async getFollowers(
    @Param('channnelId') channnelId: string,
    @Res() res: Response,
  ) {
    const data = await this.followService.getFollowers(channnelId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Followers retrieved successfully.',
      data,
    });
  }

  @ApiOperation({ summary: 'Unfollow a channel by its channnelId' })
  @UseGuards(JwtAuthGuard)
  @Delete(':channnelId')
  async unfollow(
    @Param('channnelId') channnelId: string,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    await this.followService.unfollowChannel(req.user.id, channnelId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Channel unfollowed successfully.',
      data: {},
    });
  }

  @ApiOperation({ summary: 'Get total follower count by channel ID' })
  @Get('count/:channelId')
  async getFollowerCount(
    @Param('channelId') channelId: string,
    @Res() res: Response,
  ) {
    const data = await this.followService.getFollowerCount(channelId);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Follower count retrieved successfully.',
      data,
    });
  }
}
