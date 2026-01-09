import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';

export enum BanType {
  PERMANENT = 'PERMANENT',
  TEMPORARY = 'TEMPORARY',
}

export class BanUserDto {
  @ApiProperty({
    description: 'ID of the user to ban',
    example: 'c1a2b3d4-e5f6-7890-abcd-1234567890ab',
  })
  @IsString()
  userId: string;

  @ApiPropertyOptional({
    description: 'Reason for banning the user',
    example: 'Violation of community guidelines',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({
    description: 'Type of ban',
    enum: BanType,
    example: BanType.TEMPORARY,
  })
  @IsEnum(BanType)
  banType: BanType;

  @ApiPropertyOptional({
    description: 'Ban expiration date (required if banType is TEMPORARY)',
    example: '2025-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string; // Required if banType is TEMPORARY
}

export class UnbanUserDto {
  @ApiProperty({
    description: 'ID of the user to unban',
    example: 'c1a2b3d4-e5f6-7890-abcd-1234567890ab',
  })
  @IsString()
  userId: string;
}
