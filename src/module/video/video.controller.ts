import { Controller, Post, Get, Param, UploadedFile, UseInterceptors, BadRequestException, Body, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { VideoService } from './video.service';

import * as path from 'path';
import * as fs from 'fs';
import { MediaServerService } from './media-server.service';

@Controller('video')
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly mediaServerService: MediaServerService,
  ) {}

  // @Post('upload')
  // @UseInterceptors(FileInterceptor('file', {
  //   storage: memoryStorage(),
  //   limits: { fileSize: 5 * 1024 * 1024 * 1024 }
  // }))
  // async uploadVideo(
  //   @UploadedFile() file: Express.Multer.File,
  //   @Body() dto: any
  // ) {
  //   if (!file) throw new BadRequestException('File not found');
    
  //   const lessonId = uuidv4();
  //   const playlistUrl = await this.videoService.processLargeVideo(file.buffer, lessonId, dto);

  //   return {
  //     success: true,
  //     playlistUrl,
  //   };
  // }

  // // Get specific live stream URL
  // @Get('live/:streamKey')
  // async getLiveStreamUrl(@Param('streamKey') streamKey: string) {
  //   const liveDir = path.resolve(process.cwd(), 'media', 'live', streamKey);
  //   const playlistPath = path.join(liveDir, 'index.m3u8');

  //   if (!fs.existsSync(playlistPath)) {
  //     throw new NotFoundException('Stream not found or not yet started. Please wait 10-15 seconds after starting OBS.');
  //   }

  //   const streamUrl = this.mediaServerService.getStreamUrl(streamKey);

  //   return {
  //     success: true,
  //     streamKey,
  //     hlsUrl: streamUrl,
  //     isLive: true,
  //     message: 'Stream is live and ready to play',
  //   };
  // }

  // // Get all active streams
  // @Get('live')
  // async getActiveStreams() {
  //   const liveDir = path.resolve(process.cwd(), 'media', 'live');
    
  //   if (!fs.existsSync(liveDir)) {
  //     return { success: true, streams: [], message: 'No active streams' };
  //   }

  //   const streams = fs.readdirSync(liveDir)
  //     .filter(dir => {
  //       const playlistPath = path.join(liveDir, dir, 'index.m3u8');
  //       return fs.existsSync(playlistPath);
  //     })
  //     .map(streamKey => ({
  //       streamKey,
  //       hlsUrl: this.mediaServerService.getStreamUrl(streamKey),
  //       isLive: true,
  //     }));

  //   return {
  //     success: true,
  //     count: streams.length,
  //     streams,
  //   };
  // }
}
