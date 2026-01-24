import { PartialType } from '@nestjs/swagger';
import { CreateVideoDto } from './create-video.dto';

export class UpdateVideoDto extends PartialType(CreateVideoDto) {}

export class InitChunkedUploadDto {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  title?: string;
  description?: string;
  streamKey: string;
}

export class UploadChunkDto {
  uploadId: string;
  chunkIndex: string;
}

export class CompleteChunkedUploadDto {
  uploadId: string;
}
