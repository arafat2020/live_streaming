import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
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
import { ChannelService } from './channel.service';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { GetMe } from '../user/dto/request-with-user.interface';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetChannelsDto } from './dto/get-channels-query.dto';
import { TermsAcceptedGuard } from 'src/common/guards/terms-accepted.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetRecommendedChannelsDto } from './dto/get-recommended-channels.dto';

@ApiTags('Channel Management')
@Controller('channel')
export class ChannelManagementController {
  constructor(private readonly channelService: ChannelService) {}

// @ApiTags('Channels')
//@UseGuards(AuthGuard('jwt'), RolesGuard,TermsAcceptedGuard)
@Get('channels')
@HttpCode(200)
@ApiOperation({ summary: 'Get all channels with optional search and pagination' })
@ApiResponse({
  status: 200,
  description: 'Channels retrieved successfully',
})
async getChannels(
  @Query() dto: GetChannelsDto,
  @Res() res: Response,
) {
  const result = await this.channelService.getChannels(dto);
  
  return sendResponse(res, {
    statusCode: HttpStatus.OK,
    success: true,
    message: 'Channels retrieved successfully.',
    data: {
    data: result.data,
    meta: result.meta,
    }
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
  @Req() req: GetMe,
  @Query() dto: GetRecommendedChannelsDto,
  @Res() res: Response,
) {
   const userId = (req as any).user?.id || null;
  const result = await this.channelService.getRecommendedChannels(
    userId,
    dto.limit,
  );
  
  return sendResponse(res, {
    statusCode: HttpStatus.OK,
    success: true,
    message: 'Channels retrieved successfully.',
    data: result
  });
}
  /*** GET /creator/channel - Retrieves the private channel details, including streamKey.*/
@ApiOperation({ summary: 'My Chennel. Retrieves the private channel details Calculate total views across all channel content' })
@UseGuards(AuthGuard('jwt'), RolesGuard,TermsAcceptedGuard)
@Roles(UserRole.CREATOR,UserRole.ADMIN)
  @Get('my-chennel')
  async getPrivateChannel(@Req() req: GetMe,@Res() res: Response) {
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
@UseGuards(AuthGuard('jwt'), RolesGuard,TermsAcceptedGuard)
@Roles(UserRole.CREATOR,UserRole.ADMIN)
  @Patch()
  async updateChannel(@Req() req: GetMe, @Body() body: UpdateChannelDto,@Res() res: Response) {
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
@UseGuards(JwtAuthGuard, RolesGuard,TermsAcceptedGuard)
@Roles(UserRole.CREATOR,UserRole.ADMIN)
  @Post('key/rotate')
  @HttpCode(200)
  async rotateStreamKey(@Req() req: GetMe,@Res() res: Response) {
    const userId = req.user.id;
    const data = await this.channelService.rotateStreamKey(userId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Generates a new stream key successfully.',
      data,
    });
  }

@ApiOperation({ summary: 'Retrieves the Signle channel details Calculate total views across all channel content' })  
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
@UseGuards(JwtAuthGuard,TermsAcceptedGuard)
@Get('/by-content/:contentId')
@ApiOperation({
  summary: 'Get contents by channel ID. This endpoint returns the cntents associated with a specific channel ID.',
  description:
    'This endpoint returns the cntents associated with a specific channel ID.',
})
async getChannelByContent(
  @Param('contentId') contentId: string,
  @Res() res: Response,
) {
  const data = await this.channelService.getContentByChannelId(contentId);

  return sendResponse(res, {
    statusCode: HttpStatus.OK,
    success: true,
    message: 'Cntent retrieved successfully.',
    data,
  });
}


}