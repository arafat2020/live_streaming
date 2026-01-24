import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ContentStatus, ContentType } from '@prisma/client';

export class UpdateContentDto {
  //   @ApiPropertyOptional({
  //     description: 'Channel ID to associate this content with',
  //     example: 'uuid',
  //   })
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @ApiPropertyOptional({
    description: 'Title of the content',
    example: 'How to build a NestJS app',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Long description of the content',
    example: 'This video explains how to structure a NestJS project...',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Category of the content',
    example: 'Gaming',
  })
  @IsOptional()
  @IsString()
  category?: string;

  //   @ApiPropertyOptional({
  //     description: 'Content type',
  //     enum: ContentType,
  //     example: ContentType.VOD,
  //   })
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;

  //   @ApiPropertyOptional({
  //     description: 'Current status of the content',
  //     enum: ContentStatus,
  //     example: ContentStatus.AVAILABLE,
  //   })
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @ApiPropertyOptional({
    description: 'Duration of the content in seconds',
    example: 360,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  //   @ApiPropertyOptional({
  //     description: 'HLS playback URL',
  //     example: 'https://pub-xxx.r2.dev/videos/lessonId/index.m3u8',
  //   })
  @IsOptional()
  @IsString()
  playbackUrl?: string;

  //   @ApiPropertyOptional({
  //     description: 'R2 folder prefix',
  //     example: 'videos/lessonId',
  //   })
  @IsOptional()
  @IsString()
  r2Prefix?: string;

  //   @ApiPropertyOptional({
  //     description: 'Original uploaded file name',
  //     example: 'my_video.mp4',
  //   })
  @IsOptional()
  @IsString()
  originalFileName?: string;

  //   @ApiPropertyOptional({
  //     description: 'Thumbnail image URL',
  //     example: 'https://cdn.example.com/thumb.jpg',
  //   })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  //   @ApiPropertyOptional({
  //     description: 'Is this premium content?',
  //     example: false,
  //   })
  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;
}
