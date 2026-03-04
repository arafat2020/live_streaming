/**
 * @fileoverview Notification Service
 *
 * Handles notification creation, retrieval, and broadcasting.
 * Supports per-user notification preferences and real-time delivery
 * via WebSocket gateway.
 *
 * @module NotificationService
 */

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

  /**
   * Creates a notification and broadcasts it in real-time.
   *
   * @param dto - Notification creation data.
   * @returns The created notification record.
   */
  async create(dto: Prisma.NotificationCreateInput) {
    const notification = await this.prisma.notification.create({ data: dto });
    this.gateway.broadcast('notification', notification);
    return notification;
  }

  /**
   * Retrieves all notifications, optionally filtered by user.
   *
   * @param userId - User ID to filter by (optional).
   * @returns Array of notification records.
   */
  async findAll(userId?: string) {
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

  /**
   * Sends a notification to a single user, respecting their notification preferences.
   *
   * @param userId    - Target user ID.
   * @param type      - Notification type.
   * @param message   - Notification message.
   * @param contentId - Optional related content ID.
   * @returns The created notification record.
   */
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
        // TODO: Re-enable real-time emit when gateway sendToUser is ready
      }
    } catch (err) {
      this.logger.warn('Emit failed', err as any);
    }
    return notification;
  }

  /**
   * Broadcasts a notification to multiple users, respecting each user's
   * notification preferences. Creates notifications in batches for efficiency.
   *
   * @param userIds   - Array of target user IDs.
   * @param type      - Notification type.
   * @param message   - Notification message.
   * @param contentId - Optional related content ID.
   * @returns Object with count of created and emitted notifications.
   */
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

    // Load user preferences for real-time emit filtering
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

    let emitted = 0;
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

        // TODO: Re-enable real-time emit when gateway sendToUser is ready
        // const unreadCount = await this.getUnreadCount(userId);
        // this.gateway.sendToUser(userId, 'notification', { notification, unreadCount });
        // emitted++;
      } catch (err) {
        this.logger.warn(`Emit to ${userId} failed`, err);
      }
    }

    return { created: rows.length, attemptedEmits: emitted };
  }

  /**
   * Broadcasts a notification to ALL users in the system.
   *
   * @param type      - Notification type.
   * @param message   - Notification message.
   * @param contentId - Optional related content ID.
   * @returns Object with count of created and emitted notifications.
   */
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
