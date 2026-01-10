import { Module } from '@nestjs/common';
import { LiveCommentService } from './live-comment.service';
import { LiveCommentController } from './live-comment.controller';
import { LiveCommentGateway } from './liveComment.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ModeratorModule } from '../moderator/moderator.module';

@Module({
  imports: [PrismaModule, AuthModule, ModeratorModule],
  controllers: [LiveCommentController],
  providers: [LiveCommentService, LiveCommentGateway],
  exports: [LiveCommentGateway]
})
export class LiveCommentModule { }
