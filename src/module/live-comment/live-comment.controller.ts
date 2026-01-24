import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { LiveCommentService } from './live-comment.service';
import { CreateLiveCommentDto } from './dto/create-live-comment.dto';
import { UpdateLiveCommentDto } from './dto/update-live-comment.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetMe } from '../user/dto/request-with-user.interface';

@ApiTags('live-comments')
@Controller('live-comments')
export class LiveCommentController {
  //constructor(private readonly liveCommentService: LiveCommentService) {}
  constructor(private readonly service: LiveCommentService) {}

  // GET /live-comments/:videoId
  @Get(':videoId')
  @ApiOperation({ summary: 'Get all comments for a video with pagination' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  getAll(
    @Param('videoId') videoId: string,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    return this.service.getAll(videoId, paginationQuery);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() body: CreateLiveCommentDto, @Req() req: GetMe) {
    const userId = req.user.id;
    return this.service.create(userId, body);
  }

  // PATCH /live-comments/:id
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLiveCommentDto) {
    return this.service.update(id, dto);
  }

  // DELETE /live-comments/:id
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
