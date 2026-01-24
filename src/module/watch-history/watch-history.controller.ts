import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { WatchHistoryService } from './watch-history.service';

@Controller('watch-history')
export class WatchHistoryController {
  constructor(private readonly service: WatchHistoryService) {}

  // Increment view count

  @ApiOperation({
    summary: 'Track a view (increment view count)',
    description:
      'Increments the view counter for a content by 1. No authentication required.',
  })
  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  async trackView(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @Ip() ip: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id;
    const data = await this.service.incrementViews(id, userId, ip);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'View tracked successfully',
      data,
    });
  }

  // Get single content with view count

  @ApiOperation({
    summary: 'Get content by ID',
    description: 'Returns content details including view count',
  })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.service.findOne(id);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content retrieved successfully',
      data,
    });
  }

  // Get top viewed content

  @ApiOperation({
    summary: 'Get most viewed content',
    description:
      'Returns list of content ordered by view count (highest first)',
  })
  @Get('top-viewed/list')
  async getTopViewed(
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 10,
    @Res() res: Response,
  ) {
    const data = await this.service.getTopViewed(limit);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Top viewed content retrieved successfully',
      data,
    });
  }
}
