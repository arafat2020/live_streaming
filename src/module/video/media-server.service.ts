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

  // Track active sessions to manage MediaLive channels
  private activeSessions = new Map<string, StreamSession>();

  constructor(
    private readonly videoService: VideoService,
    private readonly mediaLiveService: MediaLiveService,
  ) {}

  async onModuleInit() {
    this.initializeMediaServer();
  }

  onModuleDestroy() {
    this.cleanupAllSessions();
  }

  /**
   * Initialize Node Media Server with RTMP configuration
   * Transcoding is now handled by AWS MediaLive.
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

    // Register event handlers
    this.registerEventHandlers();

    this.logger.log('🎥 Media Server Ready (RTMP Ingest Only)');
    this.logger.log(
      `📍 RTMP Ingest: rtmp://${process.env.RTMP_HOST || 'localhost'}:${config.rtmp.port}/live`,
    );
  }

  /**
   * Register NMS event handlers
   */
  private registerEventHandlers() {
    this.nms.on('postPublish', (session: any) => {
      const streamPath = session?.streamPath;
      if (typeof streamPath === 'string' && streamPath.startsWith('/live/')) {
        const streamKey = streamPath.replace('/live/', '');
        this.handleStreamStart(streamKey);
      }
    });

    this.nms.on('donePublish', (session: any) => {
      const streamPath = session?.streamPath;
      if (typeof streamPath === 'string' && streamPath.startsWith('/live/')) {
        const streamKey = streamPath.replace('/live/', '');
        this.handleStreamStop(streamKey);
      }
    });
  }

  /**
   * Handle incoming RTMP stream
   * Spawns FFmpeg process with auto-restart and error recovery
   */
  private async handleStreamStart(streamKey: string) {
    try {
      this.logger.log(`🎬 Incoming stream: ${streamKey}`);

      const { contentId, channel } =
        await this.videoService.handleLiveStart(streamKey);

      this.logger.log(
        `🔴 Stream starting for ${channel.name} (Content: ${contentId})`,
      );

      const { channelId, inputId, rtmpUrl } =
        await this.mediaLiveService.startChannel({
          streamKey,
          contentId,
        });

      await this.videoService.setMediaLiveChannelId(
        contentId,
        channelId,
        inputId,
      );

      // Start FFmpeg relay with error recovery
      const localRtmpUrl = `rtmp://localhost:${process.env.RTMP_PORT || 1935}/live/${streamKey}`;
      this.logger.log(`🚀 Starting FFmpeg relay: ${localRtmpUrl} → ${rtmpUrl}`);

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

      // Start FFmpeg with auto-restart on failure
      this.startFFmpegRelay(streamKey, localRtmpUrl, rtmpUrl);
    } catch (error) {
      this.logger.error(
        `❌ Failed to start stream ${streamKey}: ${(error as any)?.message || error}`,
      );
    }
  }

  /**
   * Start FFmpeg relay process with automatic restart on failure
   */
  private startFFmpegRelay(
    streamKey: string,
    localRtmpUrl: string,
    rtmpUrl: string,
  ) {
    const session = this.activeSessions.get(streamKey);
    if (!session || !session.isRunning) {
      this.logger.debug(
        `Stream ${streamKey} is no longer active, skipping FFmpeg start`,
      );
      return;
    }

    try {
      // Kill existing process if any
      if (session.ffmpegProcess) {
        session.ffmpegProcess.kill();
      }

      this.logger.log(`🎥 Spawning FFmpeg for stream ${streamKey}`);

      const ffmpegProcess = spawn('ffmpeg', [
        '-rtmp_live',
        'live', // RTMP live stream input
        '-i',
        localRtmpUrl,
        '-c',
        'copy', // Copy codec (no re-encoding)
        '-f',
        'flv', // Output format
        '-fflags',
        'nobuffer', // Minimize buffering
        '-flags',
        'low_delay', // Low latency
        rtmpUrl,
      ]);

      session.ffmpegProcess = ffmpegProcess;

      // Log FFmpeg output for debugging
      ffmpegProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          this.logger.debug(
            `FFmpeg (${streamKey}): ${output.substring(0, 100)}`,
          );
        }
      });

      // Handle process exit/errors
      ffmpegProcess.on('error', (err) => {
        this.logger.error(`❌ FFmpeg error for ${streamKey}: ${err.message}`);
        this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
      });

      ffmpegProcess.on('close', (code) => {
        if (session.isRunning) {
          this.logger.warn(
            `⚠️ FFmpeg for ${streamKey} exited with code ${code}. Restarting...`,
          );
          this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
        } else {
          this.logger.log(`FFmpeg for ${streamKey} stopped (stream ended)`);
        }
      });

      this.logger.log(`✅ FFmpeg relay started for stream ${streamKey}`);
    } catch (error) {
      this.logger.error(
        `❌ Failed to spawn FFmpeg for ${streamKey}: ${(error as any).message}`,
      );
      this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
    }
  }

  /**
   * Schedule FFmpeg restart with exponential backoff
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
      this.logger.error(
        `❌ FFmpeg for ${streamKey} failed after ${maxRetries} restart attempts. Giving up.`,
      );
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000);

    this.logger.warn(
      `⏳ Scheduling FFmpeg restart for ${streamKey} in ${delay}ms (attempt ${attempt}/${maxRetries})`,
    );

    setTimeout(() => {
      if (session.isRunning) {
        this.startFFmpegRelay(streamKey, localRtmpUrl, rtmpUrl);
      }
    }, delay);
  }

  /**
   * Handle stream stop event
   */
  private async handleStreamStop(streamKey: string) {
    const session = this.activeSessions.get(streamKey);
    if (!session) return;

    // Mark as stopped to prevent restart attempts
    session.isRunning = false;

    try {
      await this.videoService.handleLiveStop(streamKey);

      if (session.channelId && session.inputId) {
        try {
          await this.mediaLiveService.stopChannel({
            channelId: session.channelId,
            inputId: session.inputId,
          });
        } catch (err) {
          // Log but don't throw - we still want to clean up local state
          this.logger.error(
            `⚠️ MediaLive cleanup error for stream ${streamKey}: ${(err as any)?.message}`,
          );
          // Don't re-throw, as we want to continue cleanup
        }
      }

      // Stop FFmpeg relay process
      this.stopFFmpegRelay(streamKey);

      this.activeSessions.delete(streamKey);
    } catch (error) {
      this.logger.error(
        `❌ Error stopping stream ${streamKey}: ${error.message}`,
      );
    }
  }

  /**
   * Stop FFmpeg relay process for a stream
   */
  private stopFFmpegRelay(streamKey: string) {
    try {
      const session = this.activeSessions.get(streamKey);
      if (session?.ffmpegProcess) {
        this.logger.log(`🛑 Stopping FFmpeg relay for stream ${streamKey}`);
        session.ffmpegProcess.kill('SIGTERM');

        // Force kill after 5 seconds if process doesn't exit
        setTimeout(() => {
          if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
            this.logger.warn(`⚠️ Force killing FFmpeg for ${streamKey}`);
            session.ffmpegProcess.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to stop FFmpeg for ${streamKey}: ${(error as any)?.message}`,
      );
    }
  }

  /**
   * Remove relay configuration for a stream (cleanup on stop)
   */
  private removeRelayConfig(streamKey: string) {
    // Already handled by stopFFmpegRelay
    // This method exists for API compatibility
  }

  private async cleanupAllSessions() {
    this.logger.log('🧹 Starting cleanup of all sessions and FFmpeg processes');

    // Mark all sessions as stopped to prevent restart attempts
    for (const [, session] of this.activeSessions) {
      session.isRunning = false;
    }

    // Stop all active streams
    for (const [streamKey] of this.activeSessions) {
      await this.handleStreamStop(streamKey);
    }

    if (this.nms) {
      this.nms.stop();
      this.logger.log('✅ NMS stopped');
    }
  }

  /**
   * Public API: Get safe stream playback URL
   */
  getStreamUrl(streamKey: string): string {
    const session = this.activeSessions.get(streamKey);
    if (!session) return '';
    return `${process.env.CLOUDFRONT_URL}/live/${session.contentId}/master.m3u8`;
  }

  /**
   * Public API: Get real-time stats
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
