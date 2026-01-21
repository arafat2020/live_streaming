import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
//import { ContentType } from '@prisma/client';

export class CreateVideoDto {
  @ApiPropertyOptional({
    example: 'My First Video',
    description: 'Title of the video',
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({
    example: 'This video explains NestJS streaming',
    description: 'Video description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'This video stream key',
    description: 'stream key',
  })
  @IsString()
  streamKey: string;

  @ApiPropertyOptional({
    example: 'Gaming',
    description: 'Video category',
  })
  @IsOptional()
  @IsString()
  category?: string;

  // @ApiPropertyOptional({
  //   enum: ContentType,
  //   example: ContentType.VOD,
  //   description: 'Type of content (VOD or LIVE_STREAM)',
  // })
  // @IsOptional()
  // @IsEnum(ContentType)
  // contentType?: ContentType;

}
