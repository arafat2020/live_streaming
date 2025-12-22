import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { VideoService } from '../video/video.service';

const NodeMediaServer = require('node-media-server');

@Injectable()
export class MediaServerService implements OnModuleInit {
  private readonly logger = new Logger(MediaServerService.name);

  private ffmpegMap = new Map<string, any>();
  private watcherMap = new Map<string, { stop: () => void }>();

  constructor(private readonly videoService: VideoService) {}

  onModuleInit() {
    const config = {
      rtmp: {
        port: Number(process.env.RTMP_PORT),
        chunk_size: 30000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: Number(process.env.MEDIA_HTTP_PORT),
        allow_origin: '*',
        mediaroot: path.resolve(process.cwd(), 'media'),
      },
    };

    const nms = new NodeMediaServer(config);
    nms.run();

    nms.on('postPublish', async (id: any) => {
      const streamKey = id?.streamName;
      if (!streamKey) return;

      this.logger.log(`🔴 Stream started: ${streamKey}`);

      const liveDir = path.resolve(
        process.cwd(),
        'media',
        'live',
        streamKey,
      );
      fs.mkdirSync(liveDir, { recursive: true });

      const rtmpUrl = `rtmp://${process.env.RTMP_HOST}:${process.env.RTMP_PORT}/live/${streamKey}`;
      const ffmpeg = spawn('ffmpeg', [
        '-i',
        rtmpUrl,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-f',
        'hls',
        '-hls_time',
        '4',
        '-hls_list_size',
        '5',
        '-hls_flags',
        'delete_segments',
        '-hls_segment_filename',
        path.join(liveDir, '%03d.ts'),
        path.join(liveDir, 'index.m3u8'),
      ]);

      this.ffmpegMap.set(streamKey, ffmpeg);

      ffmpeg.stderr.on('data', (d) =>
        this.logger.log(`[FFmpeg] ${d.toString()}`),
      );

      const watcher = await this.videoService.handleLiveStream(
        streamKey,
        liveDir,
      );
      this.watcherMap.set(streamKey, watcher);
    });

    nms.on('donePublish', (id: any) => {
      const streamKey = id?.streamName;
      if (!streamKey) return;

      this.logger.log(`🛑 Stream stopped: ${streamKey}`);

      const ffmpeg = this.ffmpegMap.get(streamKey);
      if (ffmpeg) ffmpeg.kill('SIGTERM');

      const watcher = this.watcherMap.get(streamKey);
      if (watcher) watcher.stop();

      this.ffmpegMap.delete(streamKey);
      this.watcherMap.delete(streamKey);

      const liveDir = path.resolve(
        process.cwd(),
        'media',
        'live',
        streamKey,
      );
      if (fs.existsSync(liveDir))
        fs.rmSync(liveDir, { recursive: true, force: true });
    });

    this.logger.log('🎥 Media Server Ready');
  }

  getStreamUrl(streamKey: string) {
    console.log(`getStreamUrl===================================>:${process.env.HTTP_BASE_URL}/media/live/${streamKey}/index.m3u8`)
    return `${process.env.HTTP_BASE_URL}/media/live/${streamKey}/index.m3u8`;
  }
}
