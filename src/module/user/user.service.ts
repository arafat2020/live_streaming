import {
  BadRequestException,
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

@Injectable()
export class UserService {
    private readonly logger = new Logger(UserService.name);
  constructor(private prisma: PrismaService,
    private readonly r2UploadService: R2UploadService,
    
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({select: {
        ...safeUserSelect,
      },});
    return users;
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  async findOne(id: string) {
    const isUser=await this.prisma.user.findUnique({ where: { id: id } });
    if (!isUser) {
      throw new NotFoundException('User with this ID Not exists.');
    }
    return this.prisma.user.findUnique({ where: { id },select: {...safeUserSelect,} });
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
        ...(dto.lastName && { lastName: dto.lastName }),

    };
    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No valid fields provided for update');
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
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

  let profileImageUrl: string | undefined;

  // 👉 Upload file if provided
  if (file) {
    // example: upload to R2 / S3
    //profileImageUrl = await this.uploadProfileImage(file, id);
    profileImageUrl =await this.uploadProfileImage(file, id);
  }

  const updateData = {
    ...(dto.email && { email: dto.email }),
    ...(dto.phone && { phone: dto.phone }),
    ...(dto.firstName && { firstName: dto.firstName }),
    ...(dto.lastName && { lastName: dto.lastName }),
    ...(profileImageUrl && { profileImage: profileImageUrl }),
  };

  if (Object.keys(updateData).length === 0) {
    throw new BadRequestException('No valid fields provided for update');
  }

  return this.prisma.user.update({
    where: { id },
    data: updateData,
  });
}


  async remove(id: string) {
    if (!id) {
      throw new BadRequestException('ID is required');
    }
    const isExists = await this.prisma.user.findUnique({
      where: { id }
    });
    if (!isExists) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return this.prisma.user.delete({where: { id:id }});
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
}
