import { Module } from '@nestjs/common';
//import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { MediaServerService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaServerService],
})
export class MediaModule {}
