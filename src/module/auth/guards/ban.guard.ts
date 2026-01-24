import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class BanGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      return true; // Not authenticated, let JwtAuthGuard or others handle it
    }

    // Always fetch fresh status from DB to ensure real-time enforcement
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        isBanned: true,
        banExpiresAt: true,
      },
    });

    if (!dbUser || !dbUser.isBanned) {
      return true;
    }

    // Check if ban has expired
    if (dbUser.banExpiresAt && new Date() > new Date(dbUser.banExpiresAt)) {
      // Auto-unban
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          isBanned: false,
          banExpiresAt: null,
          banReason: null,
        },
      });
      return true;
    }

    throw new ForbiddenException(
      'This account has been banned due to violations of the rules.',
    );
  }
}
