import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationService {
  private readonly DB_BATCH_SIZE = 500;
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: NotificationGateway,
  ) {}

  // async create(dto: Prisma.NotificationCreateInput) {
  //   return this.prisma.notification.create({ data: dto });
  // }
  async create(dto: Prisma.NotificationCreateInput) {
    // 1️ Save notification to DB
    const notification = await this.prisma.notification.create({ data: dto });

    // 2️ Broadcast to all users in real-time
    this.gateway.broadcast('notification', notification);

    return notification;
  }

  async findAll(userId?: string) {
    //console.log("userId-------->", userId);
    return this.prisma.notification.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async update(id: string, data: Partial<Prisma.NotificationUpdateInput>) {
    return this.prisma.notification.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.notification.delete({ where: { id } });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  // single send respecting user preferences
  public async sendNotification(
    userId: string,
    type: NotificationType,
    message: string,
    contentId?: string | null,
  ) {
    if (!userId || !message)
      throw new BadRequestException('userId and message required');
    const notification = await this.prisma.notification.create({
      data: { userId, type, message, contentId: contentId ?? null },
    });

    try {
      const pref = await this.prisma.userNotificationPreference.findUnique({
        where: { userId },
      });
      const map: Record<string, keyof NonNullable<typeof pref>> = {
        CHANNEL_LIVE: 'channelLive',
        NEW_VIDEO: 'newVideoUpload',
        ANNOUNCEMENT: 'platformAnnounce',
      } as any;
      const shouldEmit = pref ? (pref[map[type as string]] ?? true) : true;
      if (shouldEmit) {
        //const unreadCount = await this.getUnreadCount(userId);
        //this.gateway.sendToUser(userId, 'notification', { notification, unreadCount });
      }
    } catch (err) {
      this.logger.warn('Emit failed', err as any);
    }
    return notification;
  }

  // broadcast to many users (createMany + emit lite payload)
  public async broadcastToUsers(
    userIds: string[],
    type: NotificationType,
    message: string,
    contentId?: string | null,
  ) {
    if (!userIds || userIds.length === 0)
      return { created: 0, attemptedEmits: 0 };
    const rows: Prisma.NotificationCreateManyInput[] = userIds.map(
      (userId) => ({
        userId,
        type,
        message,
        contentId: contentId ?? null,
      }),
    );

    // createMany in chunks
    for (let i = 0; i < rows.length; i += this.DB_BATCH_SIZE) {
      const chunk = rows.slice(i, i + this.DB_BATCH_SIZE);
      try {
        await this.prisma.notification.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      } catch (err) {
        this.logger.warn(
          'createMany failed, falling back to individual inserts',
          err as any,
        );
        for (const r of chunk) {
          try {
            await this.prisma.notification.create({ data: r as any });
          } catch (e) {
            this.logger.error('failed insert', e as any);
          }
        }
      }
    }

    // load prefs
    const prefs = await this.prisma.userNotificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        channelLive: true,
        newVideoUpload: true,
        platformAnnounce: true,
      },
    });
    const prefMap = new Map(prefs.map((p) => [p.userId, p]));

    const emitted = 0;
    for (const userId of userIds) {
      try {
        const pref = prefMap.get(userId);
        const shouldEmit = (() => {
          if (type === 'CHANNEL_LIVE') return pref ? !!pref.channelLive : true;
          if (type === 'NEW_VIDEO') return pref ? !!pref.newVideoUpload : true;
          if (type === 'ANNOUNCEMENT')
            return pref ? !!pref.platformAnnounce : true;
          return true;
        })();

        if (!shouldEmit) continue;

        const unreadCount = await this.getUnreadCount(userId);

        const notificationLite = {
          id: null,
          userId,
          type,
          message,
          contentId,
          isRead: false,
          createdAt: new Date(),
        };

        this.logger.debug(`Emit to ${userId}`, notificationLite, unreadCount);

        // this.gateway.sendToUser(userId, 'notification', { notification: notificationLite, unreadCount });
        // emitted++;
      } catch (err) {
        this.logger.warn(`Emit to ${userId} failed`, err);
      }
    }

    return { created: rows.length, attemptedEmits: emitted };
  }

  public async broadcastToAll(
    type: NotificationType,
    message: string,
    contentId?: string | null,
  ) {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    const ids = users.map((u) => u.id);
    return this.broadcastToUsers(ids, type, message, contentId);
  }
}
