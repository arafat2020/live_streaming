import { ApiProperty } from '@nestjs/swagger';

export class DeleteStreamResponseDto {
  @ApiProperty({
    description: 'Message indicating stream deletion result',
    example: 'Stream deleted successfully',
  })
  message: string;
}
