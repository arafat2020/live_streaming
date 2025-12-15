import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
const NodeMediaServer = require('node-media-server');
@Injectable()
export class MediaServerService implements OnModuleInit {
  private readonly logger = new Logger(MediaServerService.name);
  private prisma = new PrismaClient();

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
        port: 8080,
        allow_origin: '*',
        mediaroot: path.join(process.cwd(), 'live'),
      },
      trans: {
        ffmpeg: 'ffmpeg', // Uses ffmpeg from PATH (Windows OK)
        tasks: [
          {
            app: 'live',
            hls: true,
            hlsFlags:
              '[flv][hls_time=2][hls_list_size=6][hls_flags=delete_segments]',
          },
        ],
      },
    };

    const nms = new NodeMediaServer(config);

    /**
     * 🔐 STREAM KEY VALIDATION (VERY IMPORTANT)
     */
    nms.on('prePublish', async (id, streamPath, args) => {
      const streamKey = streamPath.split('/').pop();
      if (!streamKey) {
        this.logger.warn(`❌ No stream key found`);
        (nms.getSession(id) as any)?.reject?.();
        return;
      }

      this.logger.log(`🔑 Stream attempt: ${streamKey}`);
      const isValid = await this.isStreamKeyValid(streamKey);

      if (!isValid) {
        this.logger.warn(`❌ Invalid stream key: ${streamKey}`);
        (nms.getSession(id) as any)?.reject?.();
      }
    });

    /**
     * 🔴 STREAM STARTED
     */
    nms.on('postPublish', async (id, streamPath) => {
      const streamKey = streamPath.split('/').pop();

      this.logger.log(`🔴 LIVE STARTED: ${streamKey}`);

      await this.prisma.stream.update({
        where: { streamKey },
        data: {
          status: 'LIVE',
          createdAt: new Date(),
        },
      });
    });

    /**
     * ⛔ STREAM STOPPED
     */
    nms.on('donePublish', async (id, streamPath) => {
      const streamKey = streamPath.split('/').pop();

      this.logger.log(`⛔ LIVE ENDED: ${streamKey}`);

      await this.prisma.stream.update({
        where: { streamKey:streamKey },
        data: {
          status: 'OFFLINE',
          updatedAt: new Date(),
        },
      });
    });

    nms.run();
    this.logger.log('🎥 RTMP + HLS Media Server Started');
  }

  /**
   * 🔍 Validate stream key from database
   */
  private async isStreamKeyValid(streamKey: string): Promise<boolean> {
    const stream = await this.prisma.stream.findUnique({
      where: { streamKey },
    });

    return !!stream;
  }
}
