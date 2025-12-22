import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from './module/user/user.module';
import { AuthModule } from './module/auth/auth.module';
import { MailModule } from './module/mail/mail.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { FollowModule } from './module/follow/follow.module';
import { ChannelModule } from './module/channel/channel.module';
import { ContentModule } from './module/content/content.module';
import { WatchHistoryModule } from './module/watch-history/watch-history.module';
import { UserNotificationPreferenceModule } from './module/user-notification-preference/user-notification-preference.module';
import { NotificationModule } from './module/notification/notification.module';
//import { SeederService } from './seeder/seeder.service';
import { ChatModule } from './module/chat/chat.module';
import { LiveCommentModule } from './module/live-comment/live-comment.module';
import { R2WorkerModule } from './module/r2-worker/r2-worker.module';
import { CloudflareModule } from './module/cloudflare/cloudflare.module';
import { StreamsModule } from './module/streams/streams.module';
import { VideoModule } from './module/video/video.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,      // makes ConfigService available everywhere
      envFilePath: '.env', // optional, default is .env
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('SMTP_HOST'),
          port: Number(config.get<string>('SMTP_PORT') || 587),
          secure: Number(config.get<string>('SMTP_PORT') || 587) === 465,
          auth: {
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          },
        },
        defaults: {
          from: config.get<string>('SMTP_FROM') || config.get<string>('SMTP_USER') || 'SoftVence Newsletter <noreply@softvence.com>',
        },
      }),
    }),
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
      //ChatModule,
      LiveCommentModule,
      R2WorkerModule,
      CloudflareModule,
      StreamsModule,
      VideoModule,

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
