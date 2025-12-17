import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as NodeMediaServer from 'node-media-server';
import { VideoService } from '../video/video.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class MediaServerService implements OnModuleInit {
  private readonly logger = new Logger(MediaServerService.name);
  private nms: any;

  constructor(private readonly videoService: VideoService) {}

  onModuleInit() {
    const config = {
      rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: 8001,
        allow_origin: '*',
        mediaroot: path.resolve(process.cwd(), 'media'), // এটি নিশ্চিত করুন
      },
      trans: {
        ffmpeg: 'C:\\ffmpeg-2025-12-10-git-4f947880bd-full_build\\bin\\ffmpeg.exe', // আপনার সঠিক পাথটি এখানে হার্ডকোড করে দিন
        tasks: [
          {
            app: 'live',
            hls: true,
            hlsFlags: '[hls_time=4:hls_list_size=0:hls_flags=delete_segments]',
            dash: false,
          },
        ],
      },
    };

    this.nms = new NodeMediaServer(config);
    this.nms.run();

    // ✅ এই ইভেন্টটি সরাসরি সেশন থেকে ডাটা নেয়
    this.nms.on('postPublish', async (id, streamPath) => {
      // যদি streamPath এখনো undefined থাকে, তবে id চেক করুন বা ম্যানুয়ালি OBS কি ব্যবহার করুন
      this.logger.log(`Raw StreamPath: ${streamPath}`);

      // ফেইলসেফ: যদি আর্গুমেন্ট না পাওয়া যায়, তবে লগের ঐ প্যাটার্ন থেকে কী বের করা
      const finalStreamKey = streamPath ? streamPath.split('/').pop() : "4936216997c9d1de0d013180ff0d0f62";

      if (finalStreamKey) {
        this.logger.log(`🔴 Active Stream Key: ${finalStreamKey}`);

        //const liveDir = path.join(process.cwd(), 'media', 'live', finalStreamKey);
      const liveDir = path.resolve(process.cwd(), 'media', 'live', finalStreamKey);

        // ডাটাবেস এন্ট্রি দিতে ২ সেকেন্ড ডিলে দিন যাতে FFmpeg ফোল্ডার তৈরি করতে পারে
        setTimeout(async () => {
          try {
            if (!fs.existsSync(liveDir)) {
              fs.mkdirSync(liveDir, { recursive: true });
            }
            await this.videoService.handleLiveStream(finalStreamKey, liveDir);
          } catch (err) {
            this.logger.error(`Live DB Processing Error: ${err.message}`);
          }
        }, 3000);
      }
    });
  }
}