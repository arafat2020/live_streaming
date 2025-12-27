import { Injectable,UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import {jwtConstants} from '../../../common/jwt.constants';
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
        follow: true,
        //watchHistory: true,
        //userNotificationPreference: true,
        notification: true,
        chatMessage: true,
        participants: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is inactive');
    }

    // Remove sensitive fields before returning to req.user
    // (Prisma returned the password and secrets if present)
    // we can add more keys here to exclude as needed
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      password,
      twoFactorSecret,
      passwordResetToken,
      passwordResetExpires,
      ...safeUser
    } = user;

    // safeUser is now attached to req.user
    return safeUser;
  }
}
