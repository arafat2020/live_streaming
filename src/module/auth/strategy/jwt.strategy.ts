import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { jwtConstants } from '../../../common/jwt.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { safeUserSelect } from '../../user/dto/safeUserSelect';

type JwtPayload = {
  sub: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConstants.secret,
    });
  }

  // payload is what you signed inside AuthService (sub, email, role)
  async validate(payload: JwtPayload) {
    // Optionally validate that user still exists / is active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        ...safeUserSelect,
        channel: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is inactive');
    }

    // ✅ Check if user is banned (real-time enforcement)
    if (user.isBanned) {
      // Check if temporary ban has expired
      if (user.banExpiresAt && new Date() > new Date(user.banExpiresAt)) {
        // Auto-unban expired temporary bans
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            isBanned: false,
            banExpiresAt: null,
            banReason: null,
          },
        });
        // Continue with normal flow after auto-unban
      } else {
        // User is still banned - deny access
        const banMessage = user.banExpiresAt
          ? `Your account has been temporarily banned${user.banReason ? ` for: ${user.banReason}` : ''}. Ban expires: ${new Date(user.banExpiresAt).toLocaleString()}`
          : `Your account has been permanently banned${user.banReason ? ` for: ${user.banReason}` : ''}. Please contact support for more information.`;

        throw new UnauthorizedException(banMessage);
      }
    }

    // already selected safe fields only
    return user;
  }
}
