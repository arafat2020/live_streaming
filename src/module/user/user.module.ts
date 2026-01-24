import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { VideoModule } from '../video/video.module';
import { AdminBanController } from './admin-ban.controller';
import { BanService } from './ban.service';

@Module({
  imports: [VideoModule],
  controllers: [UserController, AdminBanController],
  providers: [UserService, BanService],
  exports: [UserService, BanService],
})
export class UserModule {}
