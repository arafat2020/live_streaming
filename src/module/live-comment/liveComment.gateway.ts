import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { WatchHistoryService } from '../watch-history/watch-history.service';

@WebSocketGateway({
  namespace: '/ws/live',
  cors: { origin: '*' },
})
export class LiveCommentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LiveCommentGateway.name);

  // Track socket to content mapping
  private socketToContent = new Map<string, string>();
  private socketToUser = new Map<string, string>();

  constructor(
    @Inject(forwardRef(() => WatchHistoryService))
    private watchHistoryService: WatchHistoryService,
  ) { }

  // Handle client connection
  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }


  // Handle client disconnection AUTO-CLEANUP when user closes browser/tab

  handleDisconnect(client: Socket) {
    const contentId = this.socketToContent.get(client.id);
    const userId = this.socketToUser.get(client.id);

    if (contentId) {
      this.logger.log(`Client ${client.id} (User: ${userId || 'Anonymous'}) disconnected from content ${contentId}`);

      // Emit event so WatchHistoryService can update concurrent viewers
      this.watchHistoryService.stopWatching(contentId, userId || client.id);
      this.server.emit('viewer.left', { contentId, userId: userId || null });

      // BROADCAST LIVE STATS IMMEDIATELY
      this.broadcastLiveStats(contentId, { status: 'LIVE' });
    }

    this.socketToContent.delete(client.id);
    if (userId) {
      this.socketToUser.delete(client.id);
    }
  }


  // Join video room (for comments)

  @SubscribeMessage('join_video')
  handleJoin(
    @MessageBody() data: { videoId: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { videoId, userId } = data;

    client.join(`video:${videoId}`);

    // Track this connection
    if (userId) {
      this.socketToContent.set(client.id, videoId);
      this.socketToUser.set(client.id, userId);
    }

    this.logger.log(`Client ${client.id} joined video ${videoId}`);

    return { joined: videoId };
  }


  // NEW: Start watching (triggers view count)

  @SubscribeMessage('start_watching')
  handleStartWatching(
    @MessageBody() data: { contentId: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { contentId, userId } = data;

    client.join(`content:${contentId}`);

    // Track this connection
    this.socketToContent.set(client.id, contentId);
    if (userId) {
      this.socketToUser.set(client.id, userId);
    }

    // Emit to backend to increment views
    this.watchHistoryService.startWatching(contentId, userId || client.id);
    this.server.emit('viewer.joined', { contentId, userId: userId || null });

    // BROADCAST LIVE STATS IMMEDIATELY
    this.broadcastLiveStats(contentId, { status: 'LIVE' });

    return { watching: contentId };
  }


  // NEW: Stop watching (decrements concurrent viewers)

  @SubscribeMessage('stop_watching')
  handleStopWatching(
    @MessageBody() data: { contentId: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { contentId, userId } = data;

    client.leave(`content:${contentId}`);

    this.socketToContent.delete(client.id);
    if (userId) {
      this.socketToUser.delete(client.id);
    }

    this.logger.log(`User ${userId || 'Anonymous'} stopped watching ${contentId}`);

    // Emit to backend to update concurrent viewers
    this.watchHistoryService.stopWatching(contentId, userId || client.id);
    this.server.emit('viewer.left', { contentId, userId: userId || null });

    // BROADCAST LIVE STATS IMMEDIATELY
    this.broadcastLiveStats(contentId, { status: 'LIVE' });

    return { stopped: contentId };
  }


  // NEW: Broadcast view count update to all viewers

  broadcastViewCount(contentId: string, views: number) {
    this.server.to(`content:${contentId}`).emit('views.updated', {
      contentId,
      views,
      timestamp: new Date(),
    });

    this.logger.debug(`Broadcasted view count for ${contentId}: ${views}`);
  }


  // NEW: Broadcast concurrent viewer count (for live streams)

  broadcastConcurrentViewers(contentId: string, count: number) {
    this.server.to(`content:${contentId}`).emit('concurrent.updated', {
      contentId,
      concurrentViewers: count,
      timestamp: new Date(),
    });

    this.logger.debug(`Broadcasted concurrent viewers for ${contentId}: ${count}`);
  }

  /**
   * NEW: Broadcast combined live stats (uptime + viewer count)
   */
  broadcastLiveStats(contentId: string, stats: any) {
    if (!this.server) return;

    const viewerCount = this.watchHistoryService.getActiveViewerCount(contentId);

    this.server.to(`content:${contentId}`).emit('live_stats_update', {
      contentId,
      ...stats,
      viewerCount,
      timestamp: new Date(),
    });
  }


  // Comment events (existing functionality)

  sendCreate(videoId: string, comment: any) {
    this.server.to(`video:${videoId}`).emit('comment.created', comment);
  }

  sendUpdate(videoId: string, comment: any) {
    this.server.to(`video:${videoId}`).emit('comment.updated', comment);
  }

  sendDelete(videoId: string, id: string) {
    this.server.to(`video:${videoId}`).emit('comment.deleted', { id });
  }


  // Stream events (existing functionality)

  streamLive(playbackUrl: string, content: any) {
    this.logger.log('Broadcasting stream.live event', {
      playbackUrl,
      contentId: content.id,
    });

    this.server.emit('stream.live', {
      playbackUrl,
      status: 'LIVE',
      content: content,
    });
  }

  streamEnded() {
    this.logger.log('Broadcasting stream.ended event');

    this.server.emit('stream.ended', {
      status: 'ENDED',
    });
  }


  // Get room stats (debugging)

  @SubscribeMessage('get_stats')
  async handleGetStats(@MessageBody() contentId: string) {
    if (!this.server) return { contentId, connectedClients: 0 };

    const adapter = (this.server as any).adapter || (this.server.sockets as any)?.adapter;
    const room = adapter?.rooms?.get(`content:${contentId}`);
    const viewerCount = room ? room.size : 0;

    return {
      contentId,
      connectedClients: viewerCount,
    };
  }
}