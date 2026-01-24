import { ApiProperty } from '@nestjs/swagger';

class PartDto {
  @ApiProperty({ description: '1-based part number', example: 1 })
  PartNumber!: number;

  @ApiProperty({
    description:
      'ETag returned by the UploadPart response. Pass it exactly as returned (including quotes).',
    example: '"9b2cf535f27731c974343645a3985328"',
  })
  ETag!: string;
}

export class CompleteR2Dto {
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

  @ApiProperty({
    type: [PartDto],
    description: 'Array of uploaded part numbers and ETags, in any order',
  })
  parts!: PartDto[];
}
