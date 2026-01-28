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
    const superAdminUsername = this.configService.getOrThrow<string>(
      'SUPER_ADMIN_USERNAME',
    );
    const superAdminEmail =
      this.configService.getOrThrow<string>('SUPER_ADMIN_EMAIL');

    const superAdminPassword = this.configService.getOrThrow<string>(
      'SUPER_ADMIN_PASSWORD',
    );

    if (!superAdminUsername || !superAdminEmail || !superAdminPassword) {
      this.logger.warn(
        'SUPER_ADMIN_USERNAME or SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD not set. Skipping admin seeding.',
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

    let user = existingAdminByUsername || existingAdminByEmail;

    if (user) {
      // If found, ensure role is ADMIN
      if (user.role !== UserRole.ADMIN || user.status !== 'ACTIVE') {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            role: UserRole.ADMIN,
            status: 'ACTIVE',
          },
        });
        this.logger.log(
          `System: Ensured ${user.username || user.email} is ADMIN and ACTIVE`,
        );
      } else {
        this.logger.log('Admin already exists and is active.');
      }
    } else {
      const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

      // Create new admin user
      user = await this.prisma.user.create({
        data: {
          username: superAdminUsername,
          email: superAdminEmail, // Required by schema
          password: hashedPassword,
          firstName: 'Super',
          lastName: 'Admin',
          role: UserRole.ADMIN,
          status: 'ACTIVE', // Ensure admin is active by default

          // Important flags for admin
          verified: true,
          ageConfirmed: true,
          termsAccepted: true,
          termsAcceptedAt: new Date(),
          privacyAccepted: true,
          privacyAcceptedAt: new Date(),
        },
      });

      this.logger.log(
        `✅ Default super admin created: ${superAdminUsername} (${superAdminEmail})`,
      );
    }

    // Check if channel exists for the admin
    const existingChannel = await this.prisma.channel.findFirst({
      where: { ownerId: user.id },
    });

    if (existingChannel) {
      this.logger.log(`Channel already exists for admin: ${user.username}`);
    }

    if (!existingChannel) {
      // Create Channel for Admin
      const handle = user.username!; // Use username as handle since it's unique
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
      this.logger.log(`✅ Channel created for admin: ${finalHandle}`);
    }
  }
}
