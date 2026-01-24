import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateModeratorDto {
  @ApiProperty({
    description: 'The UUID of the user to be assigned as moderator',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'The UUID of the channel where the user will be a moderator',
    example: '123e4567-e89b-12d3-a456-426614174001',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  channelId: string;
}
