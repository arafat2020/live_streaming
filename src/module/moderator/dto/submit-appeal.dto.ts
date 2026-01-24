import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class SubmitAppealDto {
  @ApiProperty({
    description: 'Channel ID to appeal the ban from',
    example: 'b3c2d8c1-7e5e-4a6b-9b8a-123456789abc',
  })
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @ApiProperty({
    description: 'Reason for the appeal',
    example: 'I was accidentally banned, I will follow the rules.',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
