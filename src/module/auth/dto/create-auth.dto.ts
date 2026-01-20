import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  Length,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';


export class LoginDto {
  @ApiProperty({ example: 'admin@gmail.com', description: 'User email address for login', required: true, })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'admin123', description: 'User password', required: true })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RegisterDto {

  @ApiProperty({ example: 'john', description: 'First name of the user', required: true, })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'johndoe', description: 'Unique username (optional)', required: false })
  @IsString()
  @IsOptional()
  @Length(3, 20)
  username?: string;

  @ApiProperty({ example: 'doe', description: 'Last name of the user', required: false, })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ example: 'johndoe@gmail.com', description: 'User email address', required: true, })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password', required: true })
  @IsString()
  @IsNotEmpty()
  password: string;
  @ApiProperty({ example: 'password123', description: 'Confirm password', required: true })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
  @ApiProperty({ example: '+8801712345678', description: 'Phone number (E.164 format) (optional)', required: false, })
  @IsOptional()
  //@IsPhoneNumber(null)
  phone?: string;

  //@ApiProperty({ example: 'https://cdn.example.com/avatar.png', description: 'Profile image URL (optional)', required: false, })
  @IsOptional()
  @IsString()
  profileImage?: string;

  //@ApiProperty({ example: UserRole.USER, description: 'Role of the staff member', enum: UserRole, required: false, default: UserRole.USER, })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole = UserRole.USER;

  //@ApiProperty({ example: false, description: 'Whether two-factor auth should be enabled on creation (optional)', required: false, default: false, })
  @IsOptional()
  @IsBoolean()
  is2FAEnabled?: boolean = false;
}

export class CreateAuthDto extends RegisterDto { }

export class ChangePasswordDto {
  // @ApiProperty({ example: 'test@gmail.com', description: 'Your current email address', })
  // @IsEmail({}, { message: 'Invalid email address' })
  // email: string;

  @ApiProperty({
    example: 'oldPassword123',
    description: 'Your current password',
  })
  @IsString({ message: 'Old password must be a string.' })
  oldPassword: string;

  @ApiProperty({
    example: 'newSecurePass456',
    description: 'Your new password',
  })
  @IsString({ message: 'New password must be a string.' })
  @IsNotEmpty({ message: 'New password is required.' })
  newPassword: string;

}


export class RequestResetCodeDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Registered email address to receive the reset code',
  })
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;
}

export class VerifyResetCodeDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address used to receive the reset code',
  })
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @ApiProperty({
    example: '1234',
    description: '4-digit reset code sent to the user\'s email',
  })
  @IsString()
  @Length(4, 4, { message: 'Code must be 4 characters' })
  code: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address associated with the account',
  })
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @ApiProperty({
    example: 'newStrongPassword123',
    description: 'New password',
  })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    example: 'newStrongPassword123',
    description: 'Confirm the new password',
  })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}