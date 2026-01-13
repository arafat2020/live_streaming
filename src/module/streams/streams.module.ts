import { Module } from '@nestjs/common';
import { StreamsService } from './streams.service';
import { StreamsController } from './streams.controller';
import { AdminStreamsController } from './admin-streams.controller';
import { CloudflareModule } from '../cloudflare/cloudflare.module';

@Module({
  imports: [CloudflareModule],
  controllers: [StreamsController, AdminStreamsController],
  providers: [StreamsService],
})
export class StreamsModule { }
