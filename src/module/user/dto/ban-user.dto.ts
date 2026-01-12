import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { BanType } from '@prisma/client';

export class BanUserDto {
    @IsEnum(BanType)
    banType: BanType;

    @IsOptional()
    @IsInt()
    @Min(1)
    durationInDays?: number;

    @IsOptional()
    @IsString()
    reason?: string;
}
