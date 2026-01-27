import { IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export enum ContentFilter {
    ALL = 'all',
    VIDEOS = 'videos',
    RECORDINGS = 'recordings',
}

export enum ContentSort {
    NEWEST = 'newest',
    MOST_VIEWED = 'most_viewed',
}

export class GetChannelContentDto extends PaginationDto {
    @ApiPropertyOptional({
        enum: ContentFilter,
        default: ContentFilter.ALL,
        description: 'Filter content by type',
    })
    @IsOptional()
    @IsEnum(ContentFilter)
    filter?: ContentFilter = ContentFilter.ALL;

    @ApiPropertyOptional({
        enum: ContentSort,
        default: ContentSort.NEWEST,
        description: 'Sort content',
    })
    @IsOptional()
    @IsEnum(ContentSort)
    sort?: ContentSort = ContentSort.NEWEST;
}
