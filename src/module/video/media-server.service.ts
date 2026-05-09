import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import NodeMediaServer from 'node-media-server';
import { VideoService } from '../video/video.service';
import { MediaLiveService } from './media-live.service';

interface StreamSession {
  streamKey: string;
  channelId: string;
  inputId: string;
  startTime: Date;
  contentId: string;
  ffmpegProcess?: ChildProcess;
  rtmpUrl?: string;
  isRunning: boolean;
}

@Injectable()
export class MediaServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaServerService.name);
  private nms: any;

  // Track active sessions to manage MediaLive channels and FFmpeg processes
  private activeSessions = new Map<string, StreamSession>();

  constructor(
    private readonly videoService: VideoService,
    private readonly mediaLiveService: MediaLiveService,
  ) {}

  // ==========================================
  // 1. MODULE LIFECYCLE
  // ==========================================

  async onModuleInit() {
    this.initializeMediaServer();
  }

  onModuleDestroy() {
    this.cleanupAllSessions();
  }

  // ==========================================
  // 2. MEDIA SERVER OPERATIONS (RTMP)
  // ==========================================

  /**
   * Initialize Node Media Server with RTMP configuration.
   * Transcoding is offloaded to AWS MediaLive.
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
      relay: {
        ffmpeg: '',
        tasks: [],
      },
    };

    this.nms = new NodeMediaServer(config);
    this.nms.run();

    // Register event handlers for stream start/stop
    this.registerEventHandlers();

    this.logger.log('🎥 Media Server Ready (RTMP Ingest Only)');
    this.logger.log(
      `📍 RTMP Ingest URL: rtmp://${process.env.RTMP_HOST || 'localhost'}:${config.rtmp.port}/live`,
    );
  }

  /**
   * Register NMS event handlers to detect stream state changes.
   */
  private registerEventHandlers() {
    this.nms.on('postPublish', (...args: any[]) => {
      this.logger.log(`[DEBUG] NMS postPublish fired. Args count: ${args.length}`);
      args.forEach((arg, i) => {
        if (arg && typeof arg === 'object') {
          this.logger.log(`[DEBUG] Arg ${i} keys: ${Object.keys(arg).join(', ')}`);
          this.logger.log(`[DEBUG] Arg ${i} .streamPath: ${arg.streamPath}`);
          this.logger.log(`[DEBUG] Arg ${i} .publishStreamPath: ${arg.publishStreamPath}`);
        } else {
          this.logger.log(`[DEBUG] Arg ${i}: ${arg}`);
        }
      });

      // Try to extract streamPath from different possible locations
      let streamPath = args[1]; // Expected standard
      if (!streamPath && args[0] && typeof args[0] === 'object') {
        streamPath = args[0].streamPath || args[0].publishStreamPath;
      }

      if (typeof streamPath === 'string' && streamPath.startsWith('/live/')) {
        const streamKey = streamPath.replace('/live/', '');
        this.handleStreamStart(streamKey);
      }
    });

    this.nms.on('donePublish', (id: string, streamPath: string, args: any) => {
      if (typeof streamPath === 'string' && streamPath.startsWith('/live/')) {
        const streamKey = streamPath.replace('/live/', '');
        this.handleStreamStop(streamKey);
      }
    });
  }

  // ==========================================
  // 3. SESSION MANAGEMENT
  // ==========================================

  /**
   * Orchestrates the start of a live stream:
   * 1. Initialize session in DB
   * 2. Provision AWS MediaLive resources
   * 3. Start local FFmpeg relay to AWS
   */
  private async handleStreamStart(streamKey: string) {
    try {
      this.logger.log(`🎬 Incoming stream detected: ${streamKey}`);

      // Step 1: Create DB records
      const { contentId, channel } = await this.videoService.handleLiveStart(streamKey);
      this.logger.log(`🔴 Stream starting for ${channel.name} (Content ID: ${contentId})`);

      // Step 2: Start AWS MediaLive
      const { channelId, inputId, rtmpUrl } = await this.mediaLiveService.startChannel({
        streamKey,
        contentId,
        onChannelCreated: async (cid, iid) => {
          // Store IDs immediately to handle EventBridge race conditions
          await this.videoService.setMediaLiveChannelId(contentId, cid, iid);
        },
      });

      // Step 3: Create local session state
      const session: StreamSession = {
        streamKey,
        contentId,
        channelId,
        inputId,
        startTime: new Date(),
        rtmpUrl,
        isRunning: true,
      };

      this.activeSessions.set(streamKey, session);

      // Step 4: Start FFmpeg relay to push from VPS to AWS
      const localRtmpUrl = `rtmp://localhost:${process.env.RTMP_PORT || 1935}/live/${streamKey}`;
      this.logger.log(`🚀 Relaying stream: ${localRtmpUrl} → ${rtmpUrl}`);
      this.startFFmpegRelay(streamKey, localRtmpUrl, rtmpUrl);

    } catch (error) {
      this.logger.error(
        `❌ Failed to start stream ${streamKey}: ${(error as any)?.message || error}`,
      );
    }
  }

  /**
   * Orchestrates the stop of a live stream and cleans up resources.
   */
  private async handleStreamStop(streamKey: string) {
    const session = this.activeSessions.get(streamKey);
    if (!session) return;

    // Prevent auto-restart of FFmpeg
    session.isRunning = false;

    try {
      this.logger.log(`🛑 Stopping stream session: ${streamKey}`);
      
      // Update DB status to ENDED
      await this.videoService.handleLiveStop(streamKey);

      // Release AWS resources
      if (session.channelId && session.inputId) {
        try {
          await this.mediaLiveService.stopChannel({
            channelId: session.channelId,
            inputId: session.inputId,
          });
        } catch (err) {
          this.logger.error(`⚠️ AWS cleanup failed: ${(err as any)?.message}`);
        }
      }

      // Kill local FFmpeg process
      this.stopFFmpegRelay(streamKey);
      this.activeSessions.delete(streamKey);
      
      this.logger.log(`✅ Session ${streamKey} cleaned up successfully`);
    } catch (error) {
      this.logger.error(`❌ Error stopping stream ${streamKey}: ${error.message}`);
    }
  }

  /**
   * Graceful cleanup of all sessions on shutdown.
   */
  private async cleanupAllSessions() {
    this.logger.log('🧹 Shutting down Media Server and cleaning up all active sessions...');

    for (const [streamKey, session] of this.activeSessions) {
      session.isRunning = false; // Prevent restarts
      await this.handleStreamStop(streamKey);
    }

    if (this.nms) {
      this.nms.stop();
      this.logger.log('✅ NMS stopped');
    }
  }

  // ==========================================
  // 4. FFmpeg RELAY ENGINE
  // ==========================================

  /**
   * Spawns an FFmpeg child process to relay the local RTMP stream to AWS MediaLive.
   */
  private startFFmpegRelay(
    streamKey: string,
    localRtmpUrl: string,
    rtmpUrl: string,
  ) {
    const session = this.activeSessions.get(streamKey);
    if (!session || !session.isRunning) return;

    try {
      // Ensure no dangling process exists
      if (session.ffmpegProcess) {
        session.ffmpegProcess.kill();
      }

      const ffmpegProcess = spawn('ffmpeg', [
        '-rtmp_live', 'live',
        '-i', localRtmpUrl,
        '-c', 'copy',      // Use 'copy' to minimize CPU usage (no re-encoding)
        '-f', 'flv',
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        rtmpUrl,
      ]);

      session.ffmpegProcess = ffmpegProcess;

      // Log errors/stats from FFmpeg
      ffmpegProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          this.logger.debug(`FFmpeg (${streamKey}): ${output.substring(0, 120)}`);
        }
      });

      ffmpegProcess.on('error', (err) => {
        this.logger.error(`❌ FFmpeg Error [${streamKey}]: ${err.message}`);
        this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
      });

      ffmpegProcess.on('close', (code) => {
        if (session.isRunning) {
          this.logger.warn(`⚠️ FFmpeg [${streamKey}] closed with code ${code}. Restarting...`);
          this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
        }
      });

    } catch (error) {
      this.logger.error(`❌ Spawn error [${streamKey}]: ${(error as any).message}`);
      this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
    }
  }

  /**
   * Stops a specific FFmpeg relay process.
   */
  private stopFFmpegRelay(streamKey: string) {
    const session = this.activeSessions.get(streamKey);
    if (session?.ffmpegProcess) {
      session.ffmpegProcess.kill('SIGTERM');
      
      // Force kill if it hangs
      setTimeout(() => {
        if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
          session.ffmpegProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /**
   * Implements exponential backoff for FFmpeg process recovery.
   */
  private scheduleFFmpegRestart(
    streamKey: string,
    localRtmpUrl: string,
    rtmpUrl: string,
    attempt: number = 1,
  ) {
    const session = this.activeSessions.get(streamKey);
    if (!session || !session.isRunning) return;

    const maxRetries = 5;
    if (attempt > maxRetries) {
      this.logger.error(`❌ Max FFmpeg restarts reached for ${streamKey}.`);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
    this.logger.warn(`⏳ Restarting FFmpeg for ${streamKey} in ${delay}ms...`);

    setTimeout(() => {
      if (session.isRunning) {
        this.startFFmpegRelay(streamKey, localRtmpUrl, rtmpUrl);
      }
    }, delay);
  }

  // ==========================================
  // 5. PUBLIC API & UTILITIES
  // ==========================================

  /**
   * Returns the CloudFront playback URL for an active stream.
   */
  getStreamUrl(streamKey: string): string {
    const session = this.activeSessions.get(streamKey);
    if (!session) return '';
    return `${process.env.CLOUDFRONT_URL}/live/${session.contentId}/master.m3u8`;
  }

  /**
   * Returns real-time statistics for an active stream.
   */
  getStreamStats(streamKey: string) {
    const session = this.activeSessions.get(streamKey);
    if (!session) return { isActive: false };

    return {
      isActive: true,
      uptime: Math.floor((Date.now() - session.startTime.getTime()) / 1000),
      contentId: session.contentId,
    };
  }
}
