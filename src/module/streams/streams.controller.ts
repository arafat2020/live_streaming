import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { RequestWithUser } from '../user/dto/request-with-user.interface';
import { CreateStreamDto } from './dto/create-stream.dto';

@ApiTags('Streams')
@Controller('streams')
export class StreamsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfService: CloudflareService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @ApiOperation({ summary: 'Create a new live stream (generate Stream Key)' })
  @ApiBody({ type: CreateStreamDto })
  @ApiResponse({ status: 201, description: 'Stream created successfully' })
  async createStream(
    @Req() req: RequestWithUser,
    @Body() body: CreateStreamDto,
  ) {
    const userId = req.user.id;
    console.log('userId--------->', userId);
    // const liveInput = await this.cfService.createLiveInput(userId);
    const streamName = body.name || `user_${userId}_live`;

    const liveInput = await this.cfService.createLiveInput(userId, streamName);
    return {
      liveInputId: liveInput.uid,
      rtmpsUrl: liveInput.rtmp.url,
      streamKeyMasked: `****${liveInput.rtmp.streamKey.slice(-4)}`,
      playbackUrl: liveInput.playback.hls,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':inputId/status')
  @ApiOperation({ summary: 'Get status of a live stream' })
  @ApiParam({ name: 'inputId', description: 'Cloudflare live input ID' })
  @ApiResponse({ status: 200 })
  async status(@Param('inputId') inputId: string) {
    const result = await this.cfService.getLiveInput(inputId);
    return {
      inputId: result.uid,
      status: result.status,
      viewers: result.viewers_count || 0,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':inputId/delete')
  @ApiOperation({ summary: 'Delete a live stream and revoke its stream key' })
  @ApiParam({ name: 'inputId', description: 'Cloudflare live input ID' })
  @ApiResponse({ status: 200 })
  async deleteStream(
    @Req() req: RequestWithUser,
    @Param('inputId') inputId: string,
  ) {
    const userId = req.user.id;
    console.log('userId--------->', userId);
    await this.cfService.deleteLiveInput(inputId);
    return { message: 'Stream deleted successfully' };
  }
}
