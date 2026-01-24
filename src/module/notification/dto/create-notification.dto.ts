import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum NotificationType {
  CHANNEL_LIVE = 'CHANNEL_LIVE',
  NEW_VIDEO = 'NEW_VIDEO',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
}

export class CreateNotificationDto {
  @ApiProperty({ description: 'User ID to send notification to' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({
    enum: NotificationType,
    description: 'Type of notification',
  })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiProperty({ description: 'Notification message' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: 'Related content ID if any' })
  @IsOptional()
  @IsString()
  contentId?: string;
}
