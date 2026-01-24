import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InitiateR2Dto {
  @ApiProperty({
    description:
      'Target filename / object key in R2. If not provided server will generate one.',
    example: 'uploads/2025-12-07/my-video.mp4',
    required: false,
  })
  filename?: string;

  @ApiPropertyOptional({
    description:
      'Chunk size in bytes. Must be >= 5 MiB for R2 multipart (except last part).',
    example: 8 * 1024 * 1024,
    default: 8 * 1024 * 1024,
  })
  partSize?: number;

  @ApiProperty({
    description:
      'Number of parts client will upload (client should compute: Math.ceil(fileSize / partSize)). Server uses this to generate presigned URLs.',
    example: 12,
  })
  partsCount!: number;
}
