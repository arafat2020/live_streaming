import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { VideoService } from '../video/video.service';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process'; // ✅ Add this
const NodeMediaServer = require('node-media-server');

@Injectable()
export class MediaServerService implements OnModuleInit {
  private readonly logger = new Logger(MediaServerService.name);
  private nms: any;
  private ffmpegProcesses = new Map<string, any>(); // ✅ Track FFmpeg processes

  constructor(private readonly videoService: VideoService) {}

  onModuleInit() {
    const config = {
      rtmp: { 
        port: 1935, 
        chunk_size: 60000, 
        gop_cache: true, 
        ping: 30, 
        ping_timeout: 60 
      },
      http: { 
        port: 8001, 
        allow_origin: '*',
        mediaroot: path.resolve(process.cwd(), 'media')
      },
      // ✅ REMOVE trans section - we'll handle FFmpeg manually
    };

    this.nms = new NodeMediaServer(config);
    this.nms.run();

    this.nms.on('postPublish', async (id: any, StreamPath: any, args: any) => {
      this.logger.log(`Event arguments received - ID type: ${typeof id}`);
      
      let streamKey: string | undefined;
      
      if (typeof id === 'object' && id !== null) {
        streamKey = id.streamName;
        this.logger.log(`Stream Name from object: ${streamKey}`);
      }
      
      if (!streamKey) {
        this.logger.error('❌ Could not extract stream key from event');
        return;
      }

      this.logger.log(`🔴 Stream Starting: ${streamKey}`);
      
      const liveDir = path.resolve(process.cwd(), 'media', 'live', streamKey);
      const outputPath = path.join(liveDir, 'index.m3u8');
      const rtmpUrl = `rtmp://localhost:1935/live/${streamKey}`;

      setTimeout(async () => {
        try {
          if (!fs.existsSync(liveDir)) {
            fs.mkdirSync(liveDir, { recursive: true });
            this.logger.log(`📁 Created directory: ${liveDir}`);
          }

          // ✅ Start FFmpeg manually
          this.logger.log(`🎬 Starting FFmpeg for stream: ${streamKey}`);
          this.logger.log(`📥 Input: ${rtmpUrl}`);
          this.logger.log(`📤 Output: ${outputPath}`);

          const ffmpeg = spawn('ffmpeg', [
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

          ffmpeg.stdout.on('data', (data) => {
            this.logger.log(`[FFmpeg OUT] ${data.toString()}`);
          });

          ffmpeg.stderr.on('data', (data) => {
            this.logger.log(`[FFmpeg] ${data.toString()}`);
          });

          ffmpeg.on('error', (err) => {
            this.logger.error(`❌ FFmpeg Error: ${err.message}`);
          });

          ffmpeg.on('close', (code) => {
            this.logger.log(`FFmpeg process exited with code ${code}`);
            this.ffmpegProcesses.delete(streamKey);
          });

          // Check if files are created after 10 seconds
          setTimeout(() => {
            if (fs.existsSync(liveDir)) {
              const files = fs.readdirSync(liveDir);
              this.logger.log(`📄 Files created: ${files.length > 0 ? files.join(', ') : 'NO FILES YET'}`);
              
              if (fs.existsSync(outputPath)) {
                this.logger.log(`✅ Playlist exists: ${outputPath}`);
                this.logger.log(`🔗 Stream URL: http://localhost:8000/media/live/${streamKey}/index.m3u8`);
              } else {
                this.logger.error(`❌ Playlist NOT found: ${outputPath}`);
              }
            }
          }, 10000);
          
          await this.videoService.handleLiveStream(streamKey, liveDir);
        } catch (err) {
          this.logger.error(`❌ Error: ${err.message}`);
        }
      }, 2000); // Reduced to 2 seconds
    });

    this.nms.on('donePublish', (id: any, StreamPath: any, args: any) => {
      let streamKey: string | undefined;
      
      if (typeof id === 'object' && id !== null) {
        streamKey = id.streamName;
      }
      
      if (streamKey) {
        this.logger.log(`🛑 Stream Stopped: ${streamKey}`);
        
        // Kill FFmpeg process
        const ffmpeg = this.ffmpegProcesses.get(streamKey);
        if (ffmpeg) {
          ffmpeg.kill('SIGTERM');
          this.ffmpegProcesses.delete(streamKey);
          this.logger.log(`⚰️ Killed FFmpeg process for: ${streamKey}`);
        }
      }
    });

    this.logger.log('🎥 Node Media Server Started');
    this.logger.log('📍 RTMP: rtmp://localhost:1935/live');
    this.logger.log('📍 HLS:  http://localhost:8000/media/live/{stream_key}/index.m3u8');
    this.logger.log('🔧 FFmpeg: Manual spawning (system PATH)');
  }

  getStreamUrl(streamKey: string): string {
    return `http://localhost:8000/media/live/${streamKey}/index.m3u8`;
  }

  isStreamLive(streamKey: string): boolean {
    const liveDir = path.resolve(process.cwd(), 'media', 'live', streamKey);
    const playlistPath = path.join(liveDir, 'index.m3u8');
    return fs.existsSync(playlistPath);
  }
}