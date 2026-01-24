import {
  IsOptional,
  IsString,
  IsEmail,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMyProfileDto {
  //@ApiProperty({ example: 'user@Gmail.com', description: 'user email address' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'johndoe',
    description: 'Unique username (Optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username can only contain letters, numbers, and underscores',
  })
  username?: string;

  // Note: firstName is no longer directly editable as it always syncs with username

  @ApiProperty({
    example: '0190000',
    description: 'phone member (Optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    example: 'https://your-r2-url.com/profiles/user-123/avatar.jpg',
    description: 'Profile image URL (Optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  profileImage?: string;

  @ApiProperty({
    example: '#FF5733',
    description: 'Chat username color (Hex code)',
    required: false,
  })
  @IsString()
  @IsOptional()
  chatColor?: string;
}
