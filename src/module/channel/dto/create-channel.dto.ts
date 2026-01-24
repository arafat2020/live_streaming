import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateChannelDto {
  @ApiProperty({
    description:
      'The desired public name for the new channel (e.g., "TechGuru Stream")',
    maxLength: 100,
    example: 'Awesome Gaming Channel',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
