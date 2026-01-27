import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Category } from '@prisma/client';

export class UpdateChannelDto {
  @ApiPropertyOptional({
    example: 'Tech Guru',
    description: 'Display name of the channel',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'I stream software, tutorials',
    description: 'Channel description',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: 'techguru',
    description: 'Public handle (no @). Changing is limited once every 30 days',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  handle?: string;

  @ApiPropertyOptional({
    enum: Category,
    example: Category.JUST_CHATTING,
    description: 'Default category for the next live stream',
  })
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @ApiPropertyOptional({
    example: 'My Awesome Stream',
    description: 'Title for the next live stream',
  })
  @IsOptional()
  @IsString()
  pendingTitle?: string;

  @ApiPropertyOptional({
    example: 'Join me for some fun!',
    description: 'Description for the next live stream',
  })
  @IsOptional()
  @IsString()
  pendingDescription?: string;
}
