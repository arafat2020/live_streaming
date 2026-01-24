import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GetMe } from '../user/dto/request-with-user.interface';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { ContentService } from './content.service';
import { QueryContentDto } from './dto/query-content.dto';

@ApiTags('Admin Content Management')
@Controller('admin/content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly watchHistoryService: WatchHistoryService,
  ) {}

  @ApiOperation({
    summary: 'Admin: List all contents with search and pagination',
  })
  @Get()
  async findAll(@Query() query: QueryContentDto, @Res() res: Response) {
    const data = await this.contentService.adminFindAll(query);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'All content retrieved successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'Admin: Delete any content' })
  @Delete(':id')
  async remove(
    @Req() req: GetMe,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const adminId = req.user.id;
    const adminRole = req.user.role;
    const result = await this.contentService.remove(id, adminId, adminRole);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content deleted by admin',
      data: result,
    });
  }

  @ApiOperation({ summary: 'Admin: Toggle content visibility (hide/unhide)' })
  @Patch(':id/visibility')
  async toggleVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isHidden') isHidden: boolean,
    @Res() res: Response,
  ) {
    const data = await this.contentService.toggleVisibility(id, isHidden);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Content visibility updated to ${isHidden ? 'hidden' : 'visible'}`,
      data,
    });
  }

  @ApiOperation({ summary: 'Admin: Force end a live stream' })
  @Post(':id/end-stream')
  async forceEndStream(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const data = await this.contentService.forceEndStream(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Live stream ended by admin',
      data,
    });
  }

  @ApiOperation({ summary: 'Admin: Get content analytics' })
  @Get(':id/analytics')
  async getAnalytics(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const data = await this.watchHistoryService.getContentAnalytics(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Content analytics retrieved successfully',
      data,
    });
  }

  @ApiOperation({ summary: 'Admin: Toggle shadow-ban on content' })
  @Patch(':id/shadow-ban')
  async toggleShadowBan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { isShadowBanned: boolean },
    @Res() res: Response,
  ) {
    const { isShadowBanned } = body;
    const data = await this.contentService.toggleShadowBan(id, isShadowBanned);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: `Content shadow-ban status updated to ${isShadowBanned ? 'banned' : 'unbanned'}`,
      data,
    });
  }
}
