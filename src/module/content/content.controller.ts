import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { QueryContentDto } from './dto/query-content.dto';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { ApiOperation } from '@nestjs/swagger';

@Controller('content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}
  @ApiOperation({ summary: 'Create new content for a channel' })
  @Post()
  async create(@Body() dto: CreateContentDto, @Res() res: Response) {
    const data = await this.contentService.create(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Content created successfully.',
      data,
    });
  }
  @ApiOperation({ summary: 'List contents (supports filtering, search and pagination)' })
 //@ApiTags('Content')
@Get()
async findAll(
  @Query() query: QueryContentDto,
  @Res() res: Response,
) {
  const result = await this.contentService.findAll(query);

  return sendResponse(res, {
    statusCode: HttpStatus.OK,
    success: true,
    message: 'Content retrieved successfully.',
    data: {
      data:result.data,
      meta: result.meta,
    }
  });
}
  @ApiOperation({ summary: 'Get a single content item by its ID' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.contentService.findOne(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content retrieve successfully.',
      data,
    });
  }
  @ApiOperation({ summary: 'Update content by its ID (partial updates supported)' })
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContentDto, @Res() res: Response) {
    const data = await this.contentService.update(id, dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content updated successfully.',
      data,
    });
  }

  @ApiOperation({ summary: 'Delete content by its ID' })
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.contentService.remove(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content deleted successfully.',
      data,
    });
  }

  // optional route to increment views
  @ApiOperation({ summary: 'Increment view count for a content item (idempotent endpoint for tracking views)' })
  @Post(':id/views')
  @HttpCode(200)
  incrementViews(@Param('id', ParseUUIDPipe) id: string) {
    return this.contentService.incrementViews(id);
  }
}
