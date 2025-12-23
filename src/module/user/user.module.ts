import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { VideoModule } from '../video/video.module';

@Module({
  imports:[ VideoModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
