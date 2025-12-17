import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { VideoService } from './video.service';

@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

@Post('upload')
@UseInterceptors(FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // ৫ জিবি
}))
async uploadVideo(
  @UploadedFile() file: Express.Multer.File,
  @Body() dto: any // ফ্রন্টএন্ড থেকে title এবং channelId আসবে
) {
  if (!file) throw new BadRequestException('ফাইল পাওয়া যায়নি');
  
  const lessonId = uuidv4();
  // ভিডিও প্রসেস শুরু করুন এবং প্লেলিস্ট ইউআরএল রিটার্ন করুন
  const playlistUrl = await this.videoService.processLargeVideo(file.buffer, lessonId, dto);

  return {
    success: true,
    playlistUrl,
  };
}
}