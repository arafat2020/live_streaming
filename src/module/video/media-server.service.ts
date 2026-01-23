import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { VideoService } from '../video/video.service';
import { ThumbnailService } from './thumbnail.service';

const NodeMediaServer = require('node-media-server');

interface StreamSession {
  streamKey: string;
  ffmpegProcess: ChildProcess;
  watcher: { stop: () => void };
  liveDir: string;
  startTime: Date;
  contentId: string; // ✅ Track contentId for stats
}
@Injectable()
export class MediaServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaServerService.name);
  private nms: any;

  // Store all active stream sessions
  private activeSessions = new Map<string, StreamSession>();

  constructor(
    private readonly videoService: VideoService,
    private readonly thumbnailService: ThumbnailService,
  ) { }

  async onModuleInit() {
    this.initializeMediaServer();
    this.startStatsBroadcast();
    await this.videoService.resetStaleStreams();
  }

  onModuleDestroy() {
    this.stopStatsBroadcast();
    this.cleanupAllSessions();
  }

  private statsInterval: NodeJS.Timeout;

  private startStatsBroadcast() {
    this.statsInterval = setInterval(() => {
      this.broadcastAllStats();
    }, 5000); // Every 5 seconds
  }

  private stopStatsBroadcast() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
  }

  private async broadcastAllStats() {
    for (const [streamKey, session] of this.activeSessions) {
      const uptime = Math.floor((Date.now() - session.startTime.getTime()) / 1000);

      // Tell Gateway to broadcast stats to rooms
      // We'll add this method to VideoService or call Gateway directly if possible
      this.videoService.broadcastLiveStats(session.contentId, {
        uptime,
        streamKey,
        status: 'LIVE'
      });
    }
  }

  /**
   * Step 1: Initialize Node Media Server with RTMP configuration
   */
  private initializeMediaServer() {
    const config = {
      rtmp: {
        port: Number(process.env.RTMP_PORT) || 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: Number(process.env.MEDIA_HTTP_PORT) || 8001,
        allow_origin: '*',
        mediaroot: path.resolve(process.cwd(), 'media'),
      },
    };

    this.nms = new NodeMediaServer(config);
    this.nms.run();

    // Register event handlers
    this.registerEventHandlers();

    this.logger.log('🎥 Media Server Ready');
    this.logger.log(`📍 RTMP: rtmp://${process.env.RTMP_HOST}:${config.rtmp.port}/live`);
    this.logger.log(`📍 HTTP: http://localhost:${config.http.port}`);
  }

  /**
   * Step 2: Register RTMP event handlers
   */
  private registerEventHandlers() {
    // Stream started
    this.nms.on('postPublish', (id: any) => this.handleStreamStart(id));

    // Stream stopped
    this.nms.on('donePublish', (id: any) => this.handleStreamStop(id));

    // Connection events for debugging
    this.nms.on('preConnect', (id: any, args: any) => {
      this.logger.debug(`Client connecting: ${id} with args: ${JSON.stringify(args)}`);
    });
  }

  /**
   * Step 3: Handle stream start event
   */
  private async handleStreamStart(id: any) {
    const streamKey = id?.streamName;

    if (!streamKey) {
      this.logger.warn('❌ No stream key provided');
      return;
    }

    // Prevent duplicate sessions
    if (this.activeSessions.has(streamKey)) {
      this.logger.warn(`⚠️ Stream ${streamKey} already active`);
      return;
    }

    try {
      // Step 3.1: Initialize stream and get a safe Content ID
      const { contentId, channel } = await this.videoService.initializeLiveStream(streamKey);

      this.logger.log(`🔴 Stream starting for ${channel.name} (Content: ${contentId})`);

      // Step 3.2: Create directory for this stream using contentId (Secure)
      const liveDir = this.createStreamDirectory(contentId);

      // Step 3.3: Start FFmpeg transcoding
      const ffmpegProcess = this.startFFmpegTranscoding(streamKey, liveDir);

      // Step 3.4: Start R2 upload watcher and notify frontend
      const { watcher } = await this.videoService.handleLiveStream(contentId, liveDir);

      // Step 3.5: Store session information
      this.activeSessions.set(streamKey, {
        streamKey,
        contentId, // Store contentId for safe URL lookups
        ffmpegProcess,
        watcher,
        liveDir,
        startTime: new Date(),
      });

      this.logger.log(`✅ Stream is now live (Content ID: ${contentId})`);

      // Step 3.6: Generate thumbnail asynchronously from the first local segment
      const r2Prefix = `live/${contentId}`;
      const firstSegmentPath = path.join(liveDir, '000.ts');

      this.generateThumbnailDelayed(streamKey, firstSegmentPath, r2Prefix);

    } catch (error) {
      this.logger.error(`❌ Failed to start stream ${streamKey}: ${error.stack || error.message}`);
      await this.cleanupSession(streamKey);
    }
  }

  /**
   * Helper to generate thumbnail after first segment is ready
   */
  private async generateThumbnailDelayed(streamKey: string, segmentPath: string, r2Prefix: string) {
    try {
      this.logger.log(`⏳ Waiting for first segment to generate thumbnail: ${streamKey}`);

      // Poll for the first segment file (up to 30 seconds)
      let attempts = 0;
      while (attempts < 30) {
        if (fs.existsSync(segmentPath) && fs.statSync(segmentPath).size > 0) {
          const thumbnailUrl = await this.thumbnailService.generateThumbnailFromSegment(
            segmentPath,
            r2Prefix,
            streamKey
          );
          await this.videoService.updateLiveThumbnail(streamKey, thumbnailUrl);

          // Cleanup preserved segment after thumbnail is done
          if (fs.existsSync(segmentPath)) {
            fs.unlinkSync(segmentPath);
            this.logger.log(`🗑️ Deleted preserved segment: ${segmentPath}`);
          }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
      this.logger.warn(`⚠️ Timeout waiting for segment ${segmentPath} for thumbnail`);
    } catch (err) {
      this.logger.error(`❌ Thumbnail generation failed for ${streamKey}: ${err.message}`);
    }
  }

  /**
   * Step 4: Create directory for stream segments
   */
  private createStreamDirectory(contentId: string): string {
    const liveDir = path.resolve(process.cwd(), 'media', 'live', contentId);

    if (!fs.existsSync(liveDir)) {
      fs.mkdirSync(liveDir, { recursive: true });
      this.logger.debug(`📁 Created directory: ${liveDir}`);
    }

    return liveDir;
  }

  /**
   * Step 5: Start FFmpeg transcoding process
   * ✅ OPTIMIZED FOR LOW LATENCY
   */
  private startFFmpegTranscoding(streamKey: string, liveDir: string): ChildProcess {
    // Use 127.0.0.1 for internal connection within the same container
    const rtmpHost = '127.0.0.1';
    const rtmpUrl = `rtmp://${rtmpHost}:${process.env.RTMP_PORT || 1935}/live/${streamKey}`;

    this.logger.log(`🎬 FFmpeg connecting to: ${rtmpUrl}`);

    const ffmpeg = spawn('ffmpeg', [
      '-i', rtmpUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'hls',

      // ✅ OPTIMIZED: 2-second segments for faster playback start
      '-hls_time', '2',

      // ✅ OPTIMIZED: Keep 10 segments (20 seconds of video)
      '-hls_list_size', '10',

      // ✅ OPTIMIZED: Better flags for live streaming
      '-hls_flags', 'delete_segments+independent_segments+program_date_time',

      // ✅ OPTIMIZED: Event playlist type for live streams
      '-hls_playlist_type', 'event',

      // ✅ OPTIMIZED: Start numbering from 0
      '-start_number', '0',

      // ✅ OPTIMIZED: GOP size for 2-second segments (48 frames at 24fps)
      '-g', '48',
      '-keyint_min', '48',

      // ✅ OPTIMIZED: Disable scene change detection for consistent segments
      '-sc_threshold', '0',

      '-hls_segment_filename', path.join(liveDir, '%03d.ts'),
      path.join(liveDir, 'index.m3u8'),
    ]);

    // Log FFmpeg output for debugging
    ffmpeg.stderr.on('data', (data) => {
      this.logger.debug(`[FFmpeg ${streamKey}] ${data.toString().trim()}`);
    });

    ffmpeg.on('error', (error) => {
      this.logger.error(`❌ FFmpeg error for ${streamKey}: ${error.message}`);
      if (error.message.includes('ENOENT')) {
        this.logger.error('CRITICAL: FFmpeg is not installed or not in the system PATH. Live streaming will not work.');
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null) {
        this.logger.warn(`⚠️ FFmpeg exited with code ${code} for ${streamKey}`);

        // Trigger the cleanup if the session is still marked as active
        if (this.activeSessions.has(streamKey)) {
          this.logger.error(`🚨 Fatal: FFmpeg crashed for ${streamKey}. Stopping session.`);
          this.handleStreamStop({ streamName: streamKey });
        }
      } else {
        this.logger.log(`✅ FFmpeg process for ${streamKey} closed normally`);
      }
    });

    return ffmpeg;
  }

  /**
   * Step 6: Handle stream stop event
   */
  private async handleStreamStop(id: any) {
    const streamKey = id?.streamName;

    if (!streamKey) {
      this.logger.warn('❌ No stream key in stop event');
      return;
    }

    this.logger.log(`🛑 Stream stopping: ${streamKey}`);

    try {
      // Notify video service about stream end
      await this.videoService.handleLiveStop(streamKey);

      // Clean up session
      await this.cleanupSession(streamKey);

      this.logger.log(`✅ Stream ${streamKey} stopped (Remaining active: ${this.activeSessions.size})`);
    } catch (error) {
      this.logger.error(`❌ Error stopping stream ${streamKey}: ${error.message}`);
    }
  }

  /**
   * Step 7: Clean up a single stream session
   */
  private async cleanupSession(streamKey: string) {
    const session = this.activeSessions.get(streamKey);

    if (!session) {
      this.logger.debug(`No session found for ${streamKey}`);
      return;
    }

    try {
      // Stop FFmpeg process first to stop writing to the manifest
      if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
        session.ffmpegProcess.kill('SIGTERM');
        this.logger.debug(`⚰️ Killed FFmpeg for ${streamKey}`);
        // Small delay to allow FFmpeg to flush
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Finalize the manifest locally so the watcher picks it up
      const playlistPath = path.join(session.liveDir, 'index.m3u8');
      if (fs.existsSync(playlistPath)) {
        try {
          const content = fs.readFileSync(playlistPath, 'utf-8');
          if (!content.includes('#EXT-X-ENDLIST')) {
            fs.appendFileSync(playlistPath, '\n#EXT-X-ENDLIST\n');
            this.logger.log(`🏁 Finalized manifest for ${streamKey}`);
            // Give the watcher one more cycle to upload the finalized manifest
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (err) {
          this.logger.error(`Failed to finalize manifest: ${err.message}`);
        }
      }

      // Stop R2 upload watcher
      if (session.watcher) {
        session.watcher.stop();
        this.logger.debug(`⏹️ Stopped watcher for ${streamKey}`);
      }

      // Delete local files after a delay (give R2 time to upload)
      setTimeout(() => {
        try {
          if (fs.existsSync(session.liveDir)) {
            fs.rmSync(session.liveDir, { recursive: true, force: true });
            this.logger.debug(`🗑️ Deleted directory: ${session.liveDir}`);
          }
        } catch (err) {
          this.logger.error(`Failed to delete directory ${session.liveDir}: ${err.message}`);
        }
      }, 15000); // ✅ Increased to 15 seconds delay for R2 upload completion

      // Remove from active sessions
      this.activeSessions.delete(streamKey);

    } catch (error) {
      this.logger.error(`Error cleaning up session ${streamKey}: ${error.message}`);
    }
  }

  /**
   * Step 8: Clean up all active sessions (on server shutdown)
   */
  private async cleanupAllSessions() {
    this.logger.log('🧹 Cleaning up all active streams...');

    for (const [streamKey] of this.activeSessions) {
      await this.cleanupSession(streamKey);
    }

    if (this.nms) {
      this.nms.stop();
    }
  }

  /**
   * Reject a stream connection
   */
  private rejectStream(id: any) {
    try {
      // In Node Media Server, we can get session by it's internal id
      const session = this.nms.getSession(typeof id === 'string' ? id : id?.id);
      if (session) {
        session.reject();
        this.logger.log(`🚫 Connection rejected: ${id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to reject stream: ${error.message}`);
    }
  }

  /**
   * Public API: Get safe stream playback URL
   */
  getStreamUrl(streamKey: string): string {
    const session = this.activeSessions.get(streamKey);
    if (!session) return '';

    const publicUrl = process.env.PUBLIC_URL || process.env.HTTP_BASE_URL;
    return `${publicUrl}/media/live/${session.contentId}/index.m3u8`;
  }

  /**
   * Public API: Check if stream is active
   */
  isStreamActive(streamKey: string): boolean {
    return this.activeSessions.has(streamKey);
  }

  /**
   * Public API: Get all active streams
   */
  getActiveStreams(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Public API: Get stream statistics
   */
  getStreamStats(streamKey: string) {
    const session = this.activeSessions.get(streamKey);

    if (!session) {
      return null;
    }

    const uptime = Date.now() - session.startTime.getTime();

    return {
      streamKey,
      contentId: session.contentId,
      startTime: session.startTime,
      uptime: Math.floor(uptime / 1000), // seconds
      isActive: true,
    };
  }
}