import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TermsAcceptedGuard } from './common/guards/terms-accepted.guard';
import { createMailConfig } from './config/mail.config';
import { AdminDashboardModule } from './module/admin-dashboard/admin-dashboard.module';
import { AuthModule } from './module/auth/auth.module';
import { BanGuard } from './module/auth/guards/ban.guard';
import { ChannelModule } from './module/channel/channel.module';
import { ChatModule } from './module/chat/chat.module';
import { CloudflareModule } from './module/cloudflare/cloudflare.module';
import { ContentModule } from './module/content/content.module';
import { FollowModule } from './module/follow/follow.module';
import { LiveCommentModule } from './module/live-comment/live-comment.module';
import { MailModule } from './module/mail/mail.module';
import { ModeratorModule } from './module/moderator/moderator.module';
import { NotificationModule } from './module/notification/notification.module';
import { R2WorkerModule } from './module/r2-worker/r2-worker.module';
import { StreamsModule } from './module/streams/streams.module';
import { UserNotificationPreferenceModule } from './module/user-notification-preference/user-notification-preference.module';
import { UserModule } from './module/user/user.module';
import { VideoModule } from './module/video/video.module';
import { WatchHistoryModule } from './module/watch-history/watch-history.module';
import { PrismaModule } from './prisma/prisma.module';
import { SeederService } from './seeder/seeder.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 1000,
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true, // makes ConfigService available everywhere
      envFilePath: '.env', // optional, default is .env
    }),
    MailerModule.forRoot(createMailConfig()),
    PrismaModule,
    UserModule,
    AuthModule,
    MailModule,
    FollowModule,
    ChannelModule,
    ContentModule,
    WatchHistoryModule,
    UserNotificationPreferenceModule,
    NotificationModule,
    ChatModule,
    LiveCommentModule,
    R2WorkerModule,
    CloudflareModule,
    StreamsModule,
    VideoModule,
    ModeratorModule,
    AdminDashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SeederService,
    {
      provide: APP_GUARD,
      useClass: TermsAcceptedGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BanGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
