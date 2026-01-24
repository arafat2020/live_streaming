import { ApiProperty } from '@nestjs/swagger';
export class FollowResponseDto {
  @ApiProperty({
    example: true,
    description: 'Whether the operation succeeded',
  })
  success!: boolean;

  @ApiProperty({
    example: 'Followed successfully',
    description: 'Readable message',
  })
  message!: string;
}
