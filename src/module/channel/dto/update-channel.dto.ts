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
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://mywebsite.com',
    description: 'Channel website URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  websiteUrl?: string;

  @ApiPropertyOptional({
    example: 'https://twitter.com/mychannel',
    description: 'Twitter URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  twitterUrl?: string;

  @ApiPropertyOptional({
    example: 'https://youtube.com/@mychannel',
    description: 'YouTube URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  youtubeUrl?: string;

  @ApiPropertyOptional({
    example: 'https://discord.gg/mychannel',
    description: 'Discord URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  discordUrl?: string;

  @ApiPropertyOptional({
    example: 'https://instagram.com/mychannel',
    description: 'Instagram URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  instagramUrl?: string;

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
