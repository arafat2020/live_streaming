import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  constructor(private prisma: PrismaService) {}

  private readonly logger = new Logger(SeederService.name);

  async onApplicationBootstrap() {
    await this.seedAdmin();
  }

  // generate a stream key using uuidv4
  private generateStreamKey(): string {
    return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  }

  private async seedAdmin() {
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;

    if (!superAdminEmail || !superAdminPassword) {
      this.logger.warn(
        'SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD not set. Skipping admin seeding.',
      );
      return;
    }

    const superAdmin = await this.prisma.user.findUnique({
      where: { email: superAdminEmail },
    });

    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    if (superAdmin) {
      if (superAdmin.role !== UserRole.ADMIN) {
        await this.prisma.user.update({
          where: { id: superAdmin.id },
          data: { role: UserRole.ADMIN },
        });
        this.logger.log(
          `Updated role for existing user ${superAdminEmail} to ADMIN`,
        );
      } else {
        this.logger.log('Admin already exists with this email.');
      }
      return;
    }

    const user = await this.prisma.user.create({
      data: {
        email: superAdminEmail,
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: UserRole.ADMIN,

        // Important flags for admin
        verified: true,
        ageConfirmed: true,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
      },
    });

    const baseHandle = superAdminEmail.split('@')[0];
    let handle = baseHandle;
    const isHandleTaken = await this.prisma.channel.findUnique({
      where: { handle },
    });

    if (isHandleTaken) {
      handle = `${baseHandle}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const channelPayload = {
      ownerId: user.id,
      name: user.firstName,
      handle,
      description: 'Platform owner',
      streamKey: this.generateStreamKey(),
    };

    await this.prisma.channel.create({ data: channelPayload });

    this.logger.log(`✅ Default super admin created: ${superAdminEmail}`);
  }
}
