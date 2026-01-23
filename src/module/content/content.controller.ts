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
  Req,
  UseGuards,
  Ip,
} from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { QueryContentDto } from './dto/query-content.dto';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { ApiOperation } from '@nestjs/swagger';
import { GetMe } from '../user/dto/request-with-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('content')
export class ContentController {
  constructor(private readonly contentService: ContentService) { }
  // @ApiOperation({ summary: 'Create new content for a channel' })
  // @Post()
  // async create(@Body() dto: CreateContentDto, @Res() res: Response) {
  //   const data = await this.contentService.create(dto);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.CREATED,
  //     success: true,
  //     message: 'Content created successfully.',
  //     data,
  //   });
  // }
  @ApiOperation({ summary: 'List of Live broadcast on Rappio.TV' })
  @Get('live-broadcast')
  async liveOnRappioList(
    @Req() req: GetMe,
    @Res() res: Response,
  ) {
    const userId = req.user?.id;
    const data = await this.contentService.liveOnRappioList(userId);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content retrieved successfully.',
      data: data
    });
  }
  @ApiOperation({ summary: 'List contents (supports filtering, search and pagination)' })
  @Get()
  // @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: GetMe,
    @Query() query: QueryContentDto,
    @Res() res: Response,
  ) {
    const userId = req.user?.id;
    const result = await this.contentService.findAll(query, userId);

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content retrieved successfully.',
      data: {
        data: result.data,
        meta: result.meta,
      }
    });
  }
  @ApiOperation({ summary: 'Get a single content item by its ID' })
  @Get(':id')
  async findOne(
    @Req() req: GetMe,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response
  ) {
    const userId = req.user?.id;
    const data = await this.contentService.findOne(id, userId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content retrieve successfully.',
      data,
    });
  }
  @ApiOperation({ summary: 'Update content by its ID (partial updates supported)' })
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async remove(@Req() req: GetMe, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const userId = req.user?.id;
    const userRole = req.user.role;
    const data = await this.contentService.remove(id, userId, userRole);
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
  incrementViews(
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Req() req: GetMe,
  ) {
    return this.contentService.incrementViews(id, req.user?.id, ip);
  }

}
