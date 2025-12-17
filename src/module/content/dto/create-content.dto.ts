import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Min, IsUrl, IsUUID } from 'class-validator';
import { ContentType, ContentStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContentDto {
  @ApiProperty({ example: 'Introduction to NestJS' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'This video explains NestJS basics' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ContentType, example: ContentType.VOD })
  @IsEnum(ContentType)
  contentType: ContentType;

  // 🚨 এটি সাধারণত ফ্রন্টএন্ড থেকে আসে না, ব্যাকএন্ড নিজে সেট করে
  @ApiPropertyOptional({ enum: ContentStatus, example: ContentStatus.PROCESSING })
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @ApiPropertyOptional({ example: 3600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional({ example: 'https://pub-xxx.r2.dev/videos/id/index.m3u8' })
  @IsOptional()
  @IsUrl()
  playbackUrl?: string;

  @ApiPropertyOptional({ example: 'https://pub-xxx.r2.dev/videos/id/thumb.jpg' })
  @IsOptional()
  @IsUrl()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  // 🚨 r2ObjectKey পরিবর্তন করে r2Prefix করা হয়েছে 
  // কারণ HLS এর ক্ষেত্রে আমাদের পুরো ফোল্ডারটা ট্রাক করতে হয়।
  @ApiPropertyOptional({ example: 'videos/uuid-of-content', description: 'R2 Folder Prefix' })
  @IsOptional()
  @IsString()
  r2Prefix?: string;

  @ApiProperty({ example: 'b768bfdc-2d0f-4fac-1234-abcdef' })
  @IsString()
  @IsUUID() // চ্যানেল আইডি সাধারণত UUID হয়
  channelId: string;
}