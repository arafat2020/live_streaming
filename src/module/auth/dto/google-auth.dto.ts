import { ApiProperty } from '@nestjs/swagger';
import {
    IsDateString,
    IsNotEmpty,
    IsString,
    Length,
} from 'class-validator';
import { IsUsernameUnique } from './unique-username.decorator';

export class GoogleLoginDto {
    @ApiProperty({
        example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
        description: 'Google ID Token from OAuth',
        required: true,
    })
    @IsString()
    @IsNotEmpty()
    idToken: string;
}

export class GoogleSignupDto {
    @ApiProperty({
        example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
        description: 'Google ID Token from OAuth',
        required: true,
    })
    @IsString()
    @IsNotEmpty()
    idToken: string;

    @ApiProperty({
        example: 'johndoe',
        description: 'Unique username (3-20 characters, required)',
        required: true,
    })
    @IsString()
    @IsNotEmpty()
    @Length(3, 20, { message: 'Username must be between 3 and 20 characters' })
    @IsUsernameUnique()
    username: string;

    @ApiProperty({
        example: '2000-01-31',
        description: 'User date of birth (YYYY-MM-DD)',
        required: true,
    })
    @IsDateString({}, { message: 'Date of birth must be a valid date (YYYY-MM-DD)' })
    @IsNotEmpty()
    dateOfBirth: string;
}
