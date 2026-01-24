import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export enum ContentSortBy {
  MOST_RECENT = 'MOST_RECENT',
  MOST_VIEWED = 'MOST_VIEWED',
}

export class QueryContentDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    description: 'Sort content by',
    enum: ContentSortBy,
    example: ContentSortBy.MOST_RECENT,
  })
  @IsOptional()
  @IsEnum(ContentSortBy)
  sortBy?: ContentSortBy;

  @ApiPropertyOptional({
    description: 'Search by title (partial match, case-insensitive)',
    example: 'tutorial',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Filter by content status',
    example: 'ENDED',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
