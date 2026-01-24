import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateStreamDto {
  @ApiProperty({
    description: 'Optional name for the live stream',
    required: false,
    example: 'My Live Stream',
  })
  @IsOptional()
  @IsString()
  name?: string;
}
