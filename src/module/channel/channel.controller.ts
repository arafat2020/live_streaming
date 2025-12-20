import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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


@Controller('channels')
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  // @UseGuards(JwtAuthGuard)
  // @Post('onboard')
  // @HttpCode(HttpStatus.CREATED)
  // //@ApiBearerAuth()
  // @ApiOperation({ summary: 'Onboard a Creator: Create the initial channel profile' })
  // //@ApiResponse({ status: 201, description: 'Channel created successfully.', type: CreatorChannelResponseDto })
  // @ApiResponse({ status: 400, description: 'User already owns a channel.' })
  // @ApiResponse({ status: 401, description: 'Unauthorized.' })
  // @ApiResponse({ status: 403, description: 'Forbidden (User is not a CREATOR).' })
  // async onboardCreator(@Req() req: GetMe, @Body() body: CreateChannelDto) {
  //   const userId = req.user.id; // User ID attached by the AuthGuard
  //   //console.log("userId---------->", userId);
  //   // Call the factory method you already created in ChannelService
  //   const channel = await this.channelService.createChannelForCreator(
  //     userId,
  //     body.name,
  //   );

  //   return {
  //     message: 'Channel created successfully. You can now access /creator/channel endpoints.',
  //     channelHandle: channel.handle,
  //     channelId: channel.id,
  //   };
  // }


  // /**GET /channels/:handle - Public view of a channel profile and content list.*/
  // @Get(':handle')
  // async getChannel(@Param('handle') handle: string,@Res() res: Response) {
  //   const data = await this.channelService.getPublicChannel(handle);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'view of a channel profile and content list successfully.',
  //     data,
  //   });
  // }
  // //GET /channels/validate-stream/:key - Internal/RTMP Server route for stream key validation.
  // //NOTE: This should be heavily secured, ideally not exposed publicly, but placed here for demonstration.

  // @Get('validate-stream/:key')
  // @HttpCode(200)
  // async validateStreamKey(@Param('key') key: string,@Res() res: Response,) {
  //   const isValid = await this.channelService.validateStreamKey(key);
  //   // Return a simple boolean status for the RTMP server || return { valid: isValid };
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'view of a channel profile and content list successfully.',
  //     data: { valid: isValid },
  //   });
  // }

  
}