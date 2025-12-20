// import { IsOptional, IsInt, Min, IsEnum, IsString } from 'class-validator';
// import { Type } from 'class-transformer';
// import { ContentType, ContentStatus } from '@prisma/client';

// export class QueryContentDto {
//   @IsOptional()
//   @IsInt()
//   @Type(() => Number)
//   @Min(1)
//   page?: number = 1;

//   @IsOptional()
//   @IsInt()
//   @Type(() => Number)
//   @Min(1)
//   pageSize?: number = 20;

//   @IsOptional()
//   @IsString()
//   q?: string;

//   @IsOptional()
//   @IsEnum(ContentType)
//   contentType?: ContentType;

//   @IsOptional()
//   @IsEnum(ContentStatus)
//   status?: ContentStatus;

//   // optional channel filter
//   @IsOptional()
//   @IsString()
//   channelId?: string;
// }
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

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
  page?: number = 1;

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
  pageSize?: number = 20;
}
