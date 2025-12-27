import {
  IsOptional,
  IsString,
  IsEmail,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole ,UserStatus} from '@prisma/client';
export class UpdateUserDto {
  @ApiProperty({ example: 'user@Gmail.com', description: 'user email address' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Sarah', description: 'First name of the User' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  firstName?: string;

  @ApiProperty({ example: 'Sarah', description: 'Last name of the User' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiProperty({ 
    example: 'https://your-r2-url.com/profiles/user-123/avatar.jpg', 
    required: false 
  })
  @IsOptional()
  @IsString()
  @IsOptional()
  profileImage?: string;

  @ApiProperty({ example: '0190000', description: 'phone member (Optional)', required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: UserRole.ADMIN, description: 'Role of the staff member', enum: UserRole })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiProperty({ example: UserStatus.ACTIVE, description: 'Role of the staff member', enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

}
