import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  constructor(private prisma: PrismaService) {}

  private readonly logger = new Logger(SeederService.name);

  async onApplicationBootstrap() {
    await this.seedAdmin();
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

    const superAdmin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
    });

    if (superAdmin) {
      this.logger.log('Admin already exists, skipping seeding.');
      return;
    }

    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    await this.prisma.user.create({
      data: {
        email: superAdminEmail,
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: UserRole.ADMIN,

        // ✅ Important flags for admin
        verified: true,
        ageConfirmed: true,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
      },
    });

    this.logger.log(`✅ Default super admin created: ${superAdminEmail}`);
  }
}
