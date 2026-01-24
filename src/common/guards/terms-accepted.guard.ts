import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TermsAcceptedGuard implements CanActivate {
  private readonly logger = new Logger(TermsAcceptedGuard.name);

  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {
    this.logger.log('✅ TermsAcceptedGuard initialized globally');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route has @SkipTermsCheck() decorator
    const skipTermsCheck = this.reflector.getAllAndOverride<boolean>(
      'skipTermsCheck',
      [context.getHandler(), context.getClass()],
    );

    if (skipTermsCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    // If no user (not authenticated), allow - JwtAuthGuard will handle auth
    if (!userId) {
      return true;
    }

    this.logger.log(`🔍 Checking terms for user: ${userId}`);

    // Check if user has accepted terms
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ageConfirmed: true,
        termsAccepted: true,
        privacyAccepted: true,
      },
    });

    if (!user) {
      return true;
    }

    const hasAcceptedAll =
      user.ageConfirmed && user.termsAccepted && user.privacyAccepted;

    // if (!hasAcceptedAll) {
    //   this.logger.warn(`❌ User ${userId} has NOT accepted terms - blocking`);

    //   throw new ForbiddenException({
    //     statusCode: 403,
    //     message: 'You must accept the Terms of Service and Privacy Policy to continue',
    //     error: 'TERMS_NOT_ACCEPTED',
    //     redirectTo: '/accept-terms',
    //   });
    // }

    this.logger.log(`✅ User ${userId} has accepted terms`, hasAcceptedAll);
    return true;
  }
}
