import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Res,
  HttpStatus,
  Query,
  ParseUUIDPipe,
  HttpCode,
  ParseIntPipe,
} from '@nestjs/common';
import { WatchHistoryService } from './watch-history.service';
import { CreateWatchHistoryDto } from './dto/create-watch-history.dto';
import { UpdateWatchHistoryDto } from './dto/update-watch-history.dto';
import { ApiOperation } from '@nestjs/swagger';
import sendResponse from '../../utils/sendResponse';
import { Request, Response } from 'express';
import { QueryWatchHistoryDto } from './dto/query-watch-history.dto';

@Controller('watch-history')
export class WatchHistoryController {
  constructor(private readonly service: WatchHistoryService) {}

    
   // Increment view count
   
  @ApiOperation({
    summary: 'Track a view (increment view count)',
    description: 'Increments the view counter for a content by 1. No authentication required.',
  })
  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  async trackView(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const data = await this.service.incrementViews(id);

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
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
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
    description: 'Returns list of content ordered by view count (highest first)',
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

  // @ApiOperation({ summary: 'Create or update watch history for a user & content (upsert)' })
  // @Post()
  // async create(@Body() dto: CreateWatchHistoryDto, @Res() res: Response) {
  //   const data = await this.service.create(dto);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.CREATED,
  //     success: true,
  //     message: 'Watch history recorded successfully.',
  //     data,
  //   });
  // }

  // @ApiOperation({ summary: 'List watch history (supports filters and pagination)' })
  // @Get()
  // async findAll(@Query() query: QueryWatchHistoryDto, @Res() res: Response) {
  //   const data = await this.service.findAll(query);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'Watch history retrieved successfully.',
  //     data,
  //   });
  // }

  // @ApiOperation({ summary: 'Get single watch history record' })
  // @Get(':id')
  // async findOne(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
  //   const data = await this.service.findOne(id);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'Watch history retrieved successfully.',
  //     data,
  //   });
  // }

  // @ApiOperation({ summary: 'Update watch history record' })
  // @Patch(':id')
  // async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWatchHistoryDto, @Res() res: Response) {
  //   const data = await this.service.update(id, dto);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'Watch history updated successfully.',
  //     data,
  //   });
  // }

  // @ApiOperation({ summary: 'Delete watch history record' })
  // @Delete(':id')
  // @HttpCode(204)
  // async remove(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
  //   const data = await this.service.remove(id);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.OK,
  //     success: true,
  //     message: 'Watch history deleted successfully.',
  //     data,
  //   });
  // }
}
