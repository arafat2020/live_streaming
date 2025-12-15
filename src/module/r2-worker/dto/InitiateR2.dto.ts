import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class InitiateR2Dto {
  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsNumber()
  @Min(5 * 1024 * 1024)
  partSize?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  partsCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  estimatedParts?: number; // now exists
}
