import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateModeratorDto } from './create-moderator.dto';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateModeratorDto extends PartialType(CreateModeratorDto) {
    @ApiPropertyOptional({
    description: 'The UUID of the user to be assigned as moderator',
    example: '123e4567-e89b-12d3-a456-426614174000',
    type: String,
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  userId?: string;
  @ApiPropertyOptional({
    description: 'The UUID of the channel where the user will be a moderator',
    example: '123e4567-e89b-12d3-a456-426614174001',
    type: String,
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  channelId?: string;
}
