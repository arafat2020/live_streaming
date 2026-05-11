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
  private activeSessions = new Map<string, StreamSession>();
  private statsInterval: NodeJS.Timeout;

  constructor(
    private readonly videoService: VideoService,
    private readonly mediaLiveService: MediaLiveService,
  ) {}

  // ==========================================
  // 1. MODULE LIFECYCLE
  // ==========================================

  async onModuleInit() {
    if (process.env.ENABLE_MEDIA_SERVER === 'true') {
      this.initializeMediaServer();
      this.startStatsBroadcast();
      await this.videoService.resetStaleStreams();
    } else {
      this.logger.log(
        'ℹ️ Media Server disabled (ENABLE_MEDIA_SERVER is not true)',
      );
    }
  }

  async onModuleDestroy() {
    this.stopStatsBroadcast();
    await this.cleanupAllSessions();
  }

  // ==========================================
  // 2. STATS BROADCAST
  // ==========================================

  private startStatsBroadcast() {
    this.statsInterval = setInterval(() => {
      for (const [streamKey, session] of this.activeSessions) {
        const uptime = Math.floor(
          (Date.now() - session.startTime.getTime()) / 1000,
        );
        this.videoService.broadcastLiveStats(session.contentId, {
          uptime,
          streamKey,
          status: 'LIVE',
        });
      }
    }, 5000);
  }

  private stopStatsBroadcast() {
    if (this.statsInterval) clearInterval(this.statsInterval);
  }

  // ==========================================
  // 3. MEDIA SERVER INIT
  // ==========================================

  private initializeMediaServer() {
    const config = {
      rtmp: {
        port: Number(process.env.RTMP_PORT) || 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
    };

    this.nms = new NodeMediaServer(config);
    this.nms.run();
    this.registerEventHandlers();

    this.logger.log(
      '🎥 Media Server Ready (RTMP ingest + FFmpeg relay to AWS MediaLive)',
    );
    this.logger.log(
      `📍 RTMP: rtmp://${process.env.RTMP_HOST || 'localhost'}:${config.rtmp.port}/live`,
    );
  }

  // ==========================================
  // 4. EVENT HANDLERS
  // ==========================================

  private registerEventHandlers() {
    this.nms.on('postPublish', (id: any) => {
      const streamKey = this.extractStreamKey(id);
      if (streamKey) this.handleStreamStart(streamKey);
    });

    this.nms.on('donePublish', (id: any) => {
      const streamKey = this.extractStreamKey(id);
      if (streamKey) this.handleStreamStop(streamKey);
    });

    this.nms.on('preConnect', (id: any, args: any) => {
      this.logger.debug(`Client connecting: ${JSON.stringify(args)}`);
    });
  }

  /**
   * Extracts stream key from NMS event.
   * Handles both NMS event formats:
   *   - id.streamName  (older NMS)
   *   - id.streamPath  (newer NMS, format: /live/STREAM_KEY)
   */
  private extractStreamKey(id: any): string | null {
    if (id?.streamName) return id.streamName;

    if (
      typeof id?.streamPath === 'string' &&
      id.streamPath.startsWith('/live/')
    ) {
      return id.streamPath.replace('/live/', '');
    }

    this.logger.warn(
      `Could not extract stream key from NMS event: ${JSON.stringify(id)}`,
    );
    return null;
  }

  // ==========================================
  // 5. STREAM START
  // ==========================================

  private async handleStreamStart(streamKey: string) {
    // Prevent duplicate sessions from duplicate postPublish events
    if (this.activeSessions.has(streamKey)) {
      this.logger.warn(
        `⚠️ Stream ${streamKey} already active — ignoring duplicate postPublish`,
      );
      return;
    }

    try {
      this.logger.log(`🎬 Incoming stream: ${streamKey}`);

      // Step 1 — Create DB record
      const { contentId, channel } =
        await this.videoService.handleLiveStart(streamKey);

      this.logger.log(
        `🔴 Stream starting for ${channel.name} (Content: ${contentId})`,
      );

      // Step 2 — Start AWS MediaLive channel
      // ── FIX: removed onChannelCreated callback — was never called because
      // MediaLiveService.startChannel() doesn't support that parameter.
      // setMediaLiveChannelId() is now called directly after startChannel() returns.
      const { channelId, inputId, rtmpUrl } =
        await this.mediaLiveService.startChannel({
          streamKey,
          contentId,
        });

      // Step 3 — Store channelId on content record IMMEDIATELY
      // This must happen before FFmpeg relay starts so the EventBridge
      // RUNNING webhook can find the content record when it fires
      await this.videoService.setMediaLiveChannelId(
        contentId,
        channelId,
        inputId,
      );

      // Step 4 — Store session
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

      // Step 5 — Start FFmpeg relay (copy only, no re-encoding — near-zero CPU)
      // MediaLive uses RTMP_PUSH — it gives us an endpoint to push TO.
      // FFmpeg relays the stream from NMS to that MediaLive endpoint.
      const localRtmpUrl = `rtmp://localhost:${process.env.RTMP_PORT || 1935}/live/${streamKey}`;
      this.logger.log(`🚀 Relaying: ${localRtmpUrl} → ${rtmpUrl}`);
      this.startFFmpegRelay(streamKey, localRtmpUrl, rtmpUrl);

      this.logger.log(
        `✅ Stream relay started (channelId: ${channelId}, contentId: ${contentId})`,
      );
      this.logger.log(
        `⏳ Waiting for EventBridge RUNNING event to mark stream live...`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to start stream ${streamKey}: ${(error as any)?.message || error}`,
      );
      this.activeSessions.delete(streamKey);
    }
  }

  // ==========================================
  // 6. STREAM STOP
  // ==========================================

  /**
   * ── FIX: Correct stop order to prevent IDLE webhook from never firing.
   *
   * OLD (broken) order:
   *   1. handleLiveStop() — DB update
   *   2. stopFFmpegRelay() — kills FFmpeg
   *      → NMS sees FFmpeg disconnect → fires donePublish AGAIN
   *      → handleStreamStop() called again — session already deleted
   *      → stopChannel() never reached → MediaLive stays RUNNING forever
   *      → IDLE event never fires
   *
   * NEW (fixed) order:
   *   1. Delete session FIRST — duplicate donePublish is ignored
   *   2. Kill FFmpeg relay — NMS fires donePublish again but ignored ✅
   *   3. handleLiveStop() — DB update + WebSocket
   *   4. stopChannel() — MediaLive stops → goes IDLE → EventBridge fires ✅
   */
  private async handleStreamStop(streamKey: string) {
    const session = this.activeSessions.get(streamKey);

    if (!session) {
      // This is expected when donePublish fires a second time after FFmpeg is killed
      this.logger.debug(
        `No active session for ${streamKey} — duplicate donePublish ignored`,
      );
      return;
    }

    // Mark as stopped to prevent FFmpeg auto-restart
    session.isRunning = false;

    // ── FIX: Delete from map IMMEDIATELY so the duplicate donePublish
    // (fired when FFmpeg disconnects from NMS) is ignored above
    this.activeSessions.delete(streamKey);

    this.logger.log(`🛑 Stream stopping: ${streamKey}`);

    try {
      // Step 1 — Kill FFmpeg relay first
      // After this, NMS will fire donePublish again — but session is already
      // deleted so it will be ignored harmlessly
      this.stopFFmpegRelay(session);
      await new Promise((r) => setTimeout(r, 1000)); // let FFmpeg die cleanly

      // Step 2 — DB update + WebSocket stream.ended event
      await this.videoService.handleLiveStop(streamKey);

      // Step 3 — Stop + delete MediaLive channel
      // Now that FFmpeg is dead and session is removed, nothing can
      // interfere. MediaLive will go IDLE → EventBridge fires correctly.
      await this.mediaLiveService.stopChannel({
        channelId: session.channelId,
        inputId: session.inputId,
      });

      this.logger.log(
        `✅ Stream ${streamKey} fully stopped (Remaining active: ${this.activeSessions.size})`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Error stopping stream ${streamKey}: ${(error as any)?.message || error}`,
      );
    }
  }

  private async cleanupAllSessions() {
    this.logger.log('🧹 Cleaning up all active streams...');
    for (const [, session] of this.activeSessions) {
      session.isRunning = false;
    }
    for (const [streamKey] of this.activeSessions) {
      await this.handleStreamStop(streamKey);
    }
    if (this.nms) {
      this.nms.stop();
      this.logger.log('✅ NMS stopped');
    }
  }

  // ==========================================
  // 7. FFMPEG RELAY ENGINE
  // ==========================================

  /**
   * Spawns FFmpeg to relay RTMP from NMS to MediaLive.
   * Uses -c copy (passthrough) — no encoding, near-zero CPU.
   * MediaLive does all the encoding on AWS infrastructure.
   */
  private startFFmpegRelay(
    streamKey: string,
    localRtmpUrl: string,
    rtmpUrl: string,
  ) {
    const session = this.activeSessions.get(streamKey);
    if (!session || !session.isRunning) return;

    try {
      if (session.ffmpegProcess) {
        session.ffmpegProcess.kill();
      }

      const ffmpegProcess = spawn('ffmpeg', [
        '-rtmp_live',
        'live',
        '-i',
        localRtmpUrl,
        '-c',
        'copy', // passthrough — no re-encoding
        '-f',
        'flv',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        rtmpUrl,
      ]);

      session.ffmpegProcess = ffmpegProcess;

      ffmpegProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          this.logger.debug(
            `FFmpeg (${streamKey}): ${output.substring(0, 120)}`,
          );
        }
      });

      ffmpegProcess.on('error', (err) => {
        this.logger.error(`❌ FFmpeg error [${streamKey}]: ${err.message}`);
        this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
      });

      ffmpegProcess.on('close', (code) => {
        // Only restart if session is still marked as running
        // If isRunning=false, this close was triggered by our own kill() call
        if (session.isRunning) {
          this.logger.warn(
            `⚠️ FFmpeg [${streamKey}] closed with code ${code} — restarting...`,
          );
          this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
        } else {
          this.logger.debug(
            `FFmpeg [${streamKey}] closed normally after stream stop`,
          );
        }
      });

      this.logger.log(`✅ FFmpeg relay started for ${streamKey}`);
    } catch (error) {
      this.logger.error(
        `❌ Spawn error [${streamKey}]: ${(error as any).message}`,
      );
      this.scheduleFFmpegRestart(streamKey, localRtmpUrl, rtmpUrl);
    }
  }

  /**
   * ── FIX: Accepts session directly instead of looking it up from the map.
   * By the time stopFFmpegRelay() is called in handleStreamStop(),
   * the session has already been deleted from activeSessions.
   */
  private stopFFmpegRelay(session: StreamSession) {
    if (session?.ffmpegProcess) {
      this.logger.debug(`Killing FFmpeg relay for ${session.streamKey}`);
      session.ffmpegProcess.kill('SIGTERM');

      setTimeout(() => {
        if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
          this.logger.warn(`Force killing FFmpeg for ${session.streamKey}`);
          session.ffmpegProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

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
      this.logger.error(`❌ Max FFmpeg restarts reached for ${streamKey}`);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
    this.logger.warn(
      `⏳ Restarting FFmpeg for ${streamKey} in ${delay}ms (attempt ${attempt}/${maxRetries})`,
    );

    setTimeout(() => {
      if (session.isRunning) {
        this.startFFmpegRelay(streamKey, localRtmpUrl, rtmpUrl);
      }
    }, delay);
  }

  // ==========================================
  // 8. PUBLIC API
  // ==========================================

  getStreamUrl(contentId: string): string {
    return `${process.env.CLOUDFRONT_URL}/live/${contentId}/master.m3u8`;
  }

  isStreamActive(streamKey: string): boolean {
    return this.activeSessions.has(streamKey);
  }

  getActiveStreams(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  getStreamStats(streamKey: string) {
    const session = this.activeSessions.get(streamKey);
    if (!session) return { isActive: false };

    return {
      isActive: true,
      uptime: Math.floor((Date.now() - session.startTime.getTime()) / 1000),
      contentId: session.contentId,
      channelId: session.channelId,
    };
  }
}
