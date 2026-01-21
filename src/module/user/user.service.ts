import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { safeUserSelect } from './dto/safeUserSelect';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMyProfileDto } from './dto/update-myprofile-dto';
import { R2UploadService } from '../video/r2-upload.service';
import { AcceptTermsDto } from './dto/user-confirmation.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  constructor(private prisma: PrismaService,
    private readonly r2UploadService: R2UploadService,

  ) { }

  async checkUsernameAvailability(username: string): Promise<boolean> {
    if (!username || username.length < 3) {
      return false;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    return !existingUser;
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      select: { ...safeUserSelect },
    });
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      select: {
        ...safeUserSelect,
      },
    });
    return users;
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  async findOne(id: string) {
    const isUser = await this.prisma.user.findUnique({ where: { id: id } });
    if (!isUser) {
      throw new NotFoundException('User with this ID Not exists.');
    }
    return this.prisma.user.findUnique({ where: { id }, select: { ...safeUserSelect, } });
  }

  async update(id: string, dto: UpdateUserDto) {
    // check if user exists
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    const updateData = {
      ...dto,
      ...(dto.email && { email: dto.email }),
      ...(dto.phone && { phone: dto.phone }),
      ...(dto.firstName && { firstName: dto.firstName }),

    };
    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No valid fields provided for update');
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        ...safeUserSelect,
      },
    });
  }

  async myProfile(
    id: string,
    dto: UpdateMyProfileDto,
    file?: Express.Multer.File,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    const usernameChanged = !!dto.username && dto.username !== user.username;

    let profileImageUrl: string | undefined;

    // 👉 Upload file if provided
    if (file) {
      // example: upload to R2 / S3
      //profileImageUrl = await this.uploadProfileImage(file, id);
      profileImageUrl = await this.uploadProfileImage(file, id);
    }

    if (usernameChanged) {
      if (user.lastDisplayNameUpdate) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        if (user.lastDisplayNameUpdate > thirtyDaysAgo) {
          throw new BadRequestException(
            'You can only change your username once every 30 days.',
          );
        }
      }

      const existingUser = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (existingUser && existingUser.id !== id) {
        throw new BadRequestException('Username is already taken');
      }
    }

    const updateData = {
      ...(dto.email && { email: dto.email }),
      ...(dto.phone && { phone: dto.phone }),
      ...(dto.username && {
        username: dto.username,
        firstName: dto.username // Always sync firstName with username
      }),
      // Note: We don't allow direct firstName updates anymore since it should always match username
      ...((usernameChanged) && { lastDisplayNameUpdate: new Date() }),
      ...(profileImageUrl && { profileImage: profileImageUrl }),
      ...(dto.chatColor && { chatColor: dto.chatColor }),
    };

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No valid fields provided for update');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: updateData,
        select: {
          ...safeUserSelect,
        },
      });

      if (usernameChanged) {
        const channel = await tx.channel.findUnique({ where: { ownerId: id } });
        if (channel) {
          await tx.channel.update({
            where: { id: channel.id },
            data: {
              handle: dto.username,
              name: dto.username, // Use username (which is now same as firstName)
            },
          });
        }
      }

      return updatedUser;
    });
  }


  async remove(id: string) {
    if (!id) {
      throw new BadRequestException('ID is required');
    }
    const user = await this.prisma.user.findUnique({
      where: { id }
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('Cannot delete an admin user');
    }
    return this.prisma.user.delete({ where: { id: id } });
  }

  // ✅ NEW: Private method to upload profile image to R2
  private async uploadProfileImage(
    file: Express.Multer.File,
    userId: string,
  ): Promise<string> {
    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPG, PNG, and WEBP are allowed',
      );
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException('File size must not exceed 5MB');
    }

    try {
      // Generate unique filename
      const timestamp = Date.now();
      const extension = file.originalname.split('.').pop();
      const filename = `${userId}-${timestamp}.${extension}`;
      const r2Key = `profiles/${userId}/${filename}`;

      // Upload to Cloudflare R2
      const imageUrl = await this.r2UploadService.uploadBuffer(
        file.buffer,
        r2Key,
        file.mimetype,
      );

      this.logger.log(`✅ Profile image uploaded to R2: ${r2Key}`);
      //console.log("imageUrl------uploadProfileImage----->",imageUrl)
      return imageUrl;
    } catch (error) {
      this.logger.error(`Failed to upload profile image: ${error.message}`);
      throw new BadRequestException('Failed to upload profile image to R2');
    }
  }


  // user.service.ts
  async acceptTermsAndConditions(userId: string, dto: AcceptTermsDto) {
    // Validate age if DOB provided
    if (dto.dateOfBirth) {
      const age = this.calculateAge(new Date(dto.dateOfBirth));
      if (age < 18) {
        throw new ForbiddenException('You must be 18 or older to use this platform');
      }
    }

    // All must be true
    if (!dto.ageConfirmed || !dto.termsAccepted || !dto.privacyAccepted) {
      throw new ForbiddenException('You must accept all terms to continue');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ageConfirmed: true,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      },
    });

    return { message: 'Terms accepted successfully', user };
  }

  private calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  // Check if user has accepted terms (guard)
  async checkTermsAccepted(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
      },
    });
    if (!user) {
      return false;
    }

    return user.ageConfirmed && user.termsAccepted && user.privacyAccepted;
  }
  async hasAcceptedTerms(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
      },
    });

    if (!user) return false;

    return user.ageConfirmed && user.termsAccepted && user.privacyAccepted;
  }

  async getTermsStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ageConfirmed: true,
        termsAccepted: true,
        termsAcceptedAt: true,
        privacyAccepted: true,
        privacyAcceptedAt: true,
        dateOfBirth: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ageConfirmed: user.ageConfirmed,
      termsAccepted: user.termsAccepted,
      termsAcceptedAt: user.termsAcceptedAt,
      privacyAccepted: user.privacyAccepted,
      privacyAcceptedAt: user.privacyAcceptedAt,
      hasAcceptedAll: user.ageConfirmed && user.termsAccepted && user.privacyAccepted,
      age: user.dateOfBirth ? this.calculateAge(user.dateOfBirth) : null,
    };
  }

  async toggleShadowBan(userId: string, isShadowBanned: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { channel: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update user flag
      await tx.user.update({
        where: { id: userId },
        data: { isShadowBanned } as any,
      });

      // 2. If user has a channel, update all content status
      if (user.channel) {
        const newStatus = isShadowBanned ? 'SHADOW_BANNED' : 'AVAILABLE';
        await tx.content.updateMany({
          where: { channelId: user.channel.id },
          data: {
            isShadowBanned,
            status: newStatus as any
          } as any,
        });
      }

      return { success: true, isShadowBanned };
    });
  }
}
