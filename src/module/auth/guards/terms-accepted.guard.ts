import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  ForbiddenException 
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserService } from 'src/module/user/user.service';
// import { UserService } from '../user/user.service';

@Injectable()
export class TermsAcceptedGuard implements CanActivate {
  constructor(
    private userService: UserService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as exempt from terms check
    const isPublic = this.reflector.get<boolean>(
      'skipTermsCheck',
      context.getHandler(),
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      return true; // Not authenticated, let JwtAuthGuard handle it
    }

    // Check if user has accepted terms
    const hasAccepted = await this.userService.hasAcceptedTerms(userId);

    if (!hasAccepted) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'You must accept the Terms of Service and Privacy Policy to continue',
        error: 'TERMS_NOT_ACCEPTED',
        redirectTo: '/accept-terms', // Frontend will handle this
      });
    }

    return true;
  }
}
