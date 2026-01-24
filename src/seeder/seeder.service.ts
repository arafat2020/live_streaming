import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private readonly logger = new Logger(SeederService.name);

  async onApplicationBootstrap() {
    await this.seedAdmin();
  }

  // generate a stream key using uuidv4
  private generateStreamKey(): string {
    return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  }

  private async seedAdmin() {
    const superAdminUsername = this.configService.get<string>(
      'SUPER_ADMIN_USERNAME',
    );
    const superAdminEmail =
      this.configService.get<string>('SUPER_ADMIN_EMAIL') || 'admin@rappio.tv';
    const superAdminPassword = this.configService.get<string>(
      'SUPER_ADMIN_PASSWORD',
    );

    if (!superAdminUsername || !superAdminPassword) {
      this.logger.warn(
        'SUPER_ADMIN_USERNAME or SUPER_ADMIN_PASSWORD not set. Skipping admin seeding.',
      );
      return;
    }

    // Check if admin exists by username or email
    const existingAdminByUsername = await this.prisma.user.findUnique({
      where: { username: superAdminUsername },
    });

    const existingAdminByEmail = await this.prisma.user.findUnique({
      where: { email: superAdminEmail },
    });

    const superAdmin = existingAdminByUsername || existingAdminByEmail;

    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    if (superAdmin) {
      // If found, ensure role is ADMIN
      if (superAdmin.role !== UserRole.ADMIN) {
        await this.prisma.user.update({
          where: { id: superAdmin.id },
          data: { role: UserRole.ADMIN },
        });
        this.logger.log(
          `Updated role for existing user ${superAdmin.username || superAdmin.email} to ADMIN`,
        );
      } else {
        this.logger.log('Admin already exists.');
      }
      return;
    }

    // Create new admin user
    const user = await this.prisma.user.create({
      data: {
        username: superAdminUsername,
        email: superAdminEmail, // Required by schema
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

    // Create Channel for Admin
    const handle = superAdminUsername; // Use username as handle since it's unique
    const isHandleTaken = await this.prisma.channel.findUnique({
      where: { handle },
    });

    const finalHandle = isHandleTaken
      ? `${handle}-${Math.floor(1000 + Math.random() * 9000)}`
      : handle;

    const channelPayload = {
      ownerId: user.id,
      name: user.firstName,
      handle: finalHandle,
      description: 'Platform owner',
      streamKey: this.generateStreamKey(),
    };

    await this.prisma.channel.create({ data: channelPayload });

    this.logger.log(
      `✅ Default super admin created: ${superAdminUsername} (${superAdminEmail})`,
    );
  }
}
