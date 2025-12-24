import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserNotificationPreferenceDto } from './dto/create-user-notification-preference.dto';
import { UpdateUserNotificationPreferenceDto } from './dto/update-user-notification-preference.dto';
import { NotificationService } from '../notification/notification.service';


@Injectable()
export class UserNotificationPreferenceService {
  constructor(
    private prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

async create(userId: string, dto: CreateUserNotificationPreferenceDto) {
  if (!userId) throw new NotFoundException('userId required');
  //console.log("UserNotificationPreferenceService dto------------>", dto);
  
  // Use upsert instead of create
  const data = await this.prisma.userNotificationPreference.upsert({
    where: { userId }, // Find by userId
    update: { ...dto }, // If exists, update with new data
    create: { userId, ...dto }, // If doesn't exist, create new
  });
  
  // Create a notification for the user
  await this.prisma.notification.create({
    data: {
      user: { connect: { id: userId } },
      type: "ANNOUNCEMENT",
      message: "test msg",
    },
  });
  
  return data;
}

  findAll() {
    return this.prisma.userNotificationPreference.findMany();
  }

  async findOne(id: string) {
    if (!id) throw new BadRequestException('id required');
    const pref = await this.prisma.userNotificationPreference.findUnique({ where: { id } });
    if (!pref) throw new NotFoundException('preference not found');
    return pref;
  }

  async update(id: string, dto: UpdateUserNotificationPreferenceDto) {
    const pref = await this.prisma.userNotificationPreference.findUnique({ where: { id } });
    if (!pref) throw new NotFoundException('preference not found');
    return this.prisma.userNotificationPreference.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const pref = await this.prisma.userNotificationPreference.findUnique({ where: { id } });
    if (!pref) throw new NotFoundException('preference not found');
    return this.prisma.userNotificationPreference.delete({ where: { id } });
  }
}
