import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { BanType } from '@prisma/client';

export class ModeratorBanUserDto {
  @ApiProperty({
    description: 'User ID to ban',
    example: 'b3c2d8c1-7e5e-4a6b-9b8a-123456789abc',
  })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    enum: BanType,
    example: BanType.PERMANENT,
    description: 'Type of ban (PERMANENT or TEMPORARY)',
  })
  @IsEnum(BanType)
  banType: BanType;

  @ApiPropertyOptional({
    description: 'Ban expiration date (required for TEMPORARY bans)',
    example: '2026-01-10T18:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
