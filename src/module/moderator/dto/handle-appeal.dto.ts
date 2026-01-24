import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class HandleAppealDto {
  @ApiProperty({
    enum: ['APPROVED', 'REJECTED'],
    example: 'APPROVED',
    description: 'Status of the appeal (APPROVED or REJECTED)',
  })
  @IsEnum(['APPROVED', 'REJECTED'] as const)
  @IsNotEmpty()
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Note from the moderator',
    example: 'Appeal accepted, be careful next time.',
  })
  @IsOptional()
  @IsString()
  moderatorNote?: string;
}
