import { forwardRef, Module } from '@nestjs/common';
import { LiveCommentService } from './live-comment.service';
import { LiveCommentController } from './live-comment.controller';
import { LiveCommentGateway } from './liveComment.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ModeratorModule } from '../moderator/moderator.module';
import { WatchHistoryModule } from '../watch-history/watch-history.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ModeratorModule,
    forwardRef(() => WatchHistoryModule),
  ],
  controllers: [LiveCommentController],
  providers: [LiveCommentService, LiveCommentGateway],
  exports: [LiveCommentGateway],
})
export class LiveCommentModule {}
