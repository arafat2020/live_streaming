import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateLiveCommentDto {
  @ApiProperty({
    description: 'ID of the video this comment belongs to',
    example: '7a8f9e2b-1c2d-3e4f-5678-90ab12cdef34',
  })
  @IsString()
  @IsNotEmpty()
  videoId: string;

  @ApiProperty({
    description: 'Comment text to display in the live chat',
    example: 'Great stream! 🔥',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}
