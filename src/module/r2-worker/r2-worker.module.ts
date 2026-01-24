import { Module } from '@nestjs/common';
// import { R2WorkerService } from './r2-worker.service';
// import { R2WorkerController } from './r2-worker.controller';
import { MulterModule } from '@nestjs/platform-express';
import * as multer from 'multer';
import { R2Service } from './r2-worker.service';
import { R2Controller } from './r2-worker.controller';
@Module({
  imports: [
    MulterModule.register({
      storage: multer.memoryStorage(), // keep files in memory to forward to Worker
      limits: {
        fileSize: 10 * 1024 * 1024, // optional limit for chunk size (10 MB default). Adjust as needed.
      },
    }),
  ],
  controllers: [R2Controller],
  providers: [R2Service],
  exports: [R2Service],
})
export class R2WorkerModule {}
