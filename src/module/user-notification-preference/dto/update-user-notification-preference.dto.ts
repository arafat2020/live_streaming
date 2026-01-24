import { PartialType } from '@nestjs/swagger';
import { CreateUserNotificationPreferenceDto } from './create-user-notification-preference.dto';

export class UpdateUserNotificationPreferenceDto extends PartialType(
  CreateUserNotificationPreferenceDto,
) {}
