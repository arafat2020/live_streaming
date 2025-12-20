import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/ws/live',
  cors: { origin: '*' },
})
export class LiveCommentGateway {
  @WebSocketServer()
  server: Server;

  // When client connects, join video room
  @SubscribeMessage('join_video')
  handleJoin(
    @MessageBody() videoId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`video:${videoId}`);
    return { joined: videoId };
  }

  sendCreate(videoId: string, comment: any) {
    this.server.to(`video:${videoId}`).emit('comment.created', comment);
  }

  sendUpdate(videoId: string, comment: any) {
    this.server.to(`video:${videoId}`).emit('comment.updated', comment);
  }

  sendDelete(videoId: string, id: string) {
    this.server.to(`video:${videoId}`).emit('comment.deleted', { id });
  }
  streamLive(playbackUrl: string) {
    this.server.emit("stream.live", {
      playbackUrl,
      status: "LIVE",
    });
  }

  streamEnded() {
    this.server.emit("stream.ended", {
      status: "ENDED",
    });
  }

}
