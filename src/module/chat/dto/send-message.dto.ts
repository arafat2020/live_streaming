import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'User ID sending the message' })
  userId: string;

  @ApiProperty({ description: 'Message content' })
  content: string;

  @ApiProperty({
    description: 'ID of the message being replied to',
    required: false,
  })
  replyToId?: string;
}
