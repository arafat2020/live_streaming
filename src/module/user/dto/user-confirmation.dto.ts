import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class AcceptTermsDto {
  @ApiProperty({
    description: 'User confirms they are 18 years or older',
    example: true,
  })
  @IsBoolean()
  ageConfirmed: boolean;

  @ApiProperty({
    description: 'User accepts the terms and conditions',
    example: true,
  })
  @IsBoolean()
  termsAccepted: boolean;

  @ApiProperty({
    description: 'User accepts the privacy policy',
    example: true,
  })
  @IsBoolean()
  privacyAccepted: boolean;

  @ApiPropertyOptional({
    description: 'User date of birth (optional)',
    example: '2005-06-15',
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
