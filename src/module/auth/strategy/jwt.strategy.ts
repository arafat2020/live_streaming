import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { jwtConstants } from '../../../common/jwt.constants';
import { PrismaService } from '../../../prisma/prisma.service';


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
  async validate(payload: any) {
    // Optionally validate that user still exists / is active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        channel: true,
        //follow: true,
        //watchHistory: true,
        //userNotificationPreference: true,
        //notification: true,
        //chatMessage: true,
        //participants: true,
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

    // Remove sensitive fields before returning to req.user
    // (Prisma returned the password and secrets if present)
    // we can add more keys here to exclude as needed
    const {
      password: _password,
      twoFactorSecret: _twoFactorSecret,
      passwordResetToken: _passwordResetToken,
      passwordResetExpires: _passwordResetExpires,
      isBanned: _isBanned,
      banExpiresAt: _banExpiresAt,
      banReason: _banReason,
      ...safeUser
    } = user;

    // safeUser is now attached to req.user
    return safeUser;
  }
}
