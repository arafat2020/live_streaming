import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChannelHandleParamDto {
  @ApiProperty({
    example: 'tech-guru',
    description:
      'Public channel handle (without @). Example: "tech-guru" or "my-channel"',
  })
  @IsString()
  @IsNotEmpty()
  handle!: string;
}
