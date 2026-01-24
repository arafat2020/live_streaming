import { Module } from '@nestjs/common';
import { ModeratorService } from './moderator.service';
import { ModeratorController } from './moderator.controller';

@Module({
  controllers: [ModeratorController],
  providers: [ModeratorService],
  exports: [ModeratorService], // Export so other modules can use it
})
export class ModeratorModule {}
