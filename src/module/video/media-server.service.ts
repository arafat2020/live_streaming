import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { VideoService } from '../video/video.service';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
const NodeMediaServer = require('node-media-server');

@Injectable()
export class MediaServerService implements OnModuleInit {
  private readonly logger = new Logger(MediaServerService.name);
  private nms: any;
  private ffmpegProcesses = new Map<string, any>();

  constructor(private readonly videoService: VideoService) {}

  onModuleInit() {
    const config = {
      rtmp: { port: 1935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
      http: { port: 8001, allow_origin: '*', mediaroot: path.resolve(process.cwd(), 'media') },
    };

    this.nms = new NodeMediaServer(config);
    this.nms.run();

    this.nms.on('postPublish', async (id: any, streamPath: any, args: any) => {
      const streamKey = (id && typeof id === 'object') ? id.streamName : undefined;
      if (!streamKey) return this.logger.error('❌ Could not extract stream key');

      this.logger.log(`🔴 Stream Starting: ${streamKey}`);

      const liveDir = path.resolve(process.cwd(), 'media', 'live', streamKey);
      const outputPath = path.join(liveDir, 'index.m3u8');
      const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;

      if (!fs.existsSync(liveDir)) fs.mkdirSync(liveDir, { recursive: true });

      // Use absolute ffmpeg path inside Docker
      const ffmpegPath = 'ffmpeg';

      const ffmpeg = spawn(ffmpegPath, [
        '-i', rtmpUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments',
        '-hls_segment_filename', path.join(liveDir, '%03d.ts'),
        outputPath
      ]);

      this.ffmpegProcesses.set(streamKey, ffmpeg);

      ffmpeg.stderr.on('data', (data) => this.logger.log(`[FFmpeg] ${data.toString()}`));
      ffmpeg.on('close', (code) => {
        this.logger.log(`FFmpeg exited with code ${code}`);
        this.ffmpegProcesses.delete(streamKey);
      });

      // Start R2 watcher
      await this.videoService.handleLiveStream(streamKey, liveDir);
    });

    this.nms.on('donePublish', (id: any) => {
      const streamKey = (id && typeof id === 'object') ? id.streamName : undefined;
      if (!streamKey) return;

      this.logger.log(`🛑 Stream Stopped: ${streamKey}`);
      const ffmpeg = this.ffmpegProcesses.get(streamKey);
      if (ffmpeg) {
        ffmpeg.kill('SIGTERM');
        this.ffmpegProcesses.delete(streamKey);
      }

      const liveDir = path.resolve(process.cwd(), 'media', 'live', streamKey);
      if (fs.existsSync(liveDir)) fs.rmSync(liveDir, { recursive: true, force: true });
    });

    this.logger.log('🎥 Node Media Server Started');
  }

  getStreamUrl(streamKey: string): string {
    return `http://localhost:8001/media/live/${streamKey}/index.m3u8`;
  }
}
