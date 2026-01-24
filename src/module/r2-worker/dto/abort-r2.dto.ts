import { ApiProperty } from '@nestjs/swagger';

export class AbortR2Dto {
  @ApiProperty({
    description: 'UploadId returned by the initiate call',
    example: 'abc123',
  })
  uploadId!: string;

  @ApiProperty({
    description: 'Object key used for the multipart upload',
    example: 'uploads/2025-12-07/my-video.mp4',
  })
  key!: string;
}
