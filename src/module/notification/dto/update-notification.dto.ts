import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateNotificationDto } from './create-notification.dto';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {
  @ApiPropertyOptional({
    description: 'Mark notification as read or unread',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isRead?: boolean;
}
