import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      // no roles required -> allow
      return true;
    }

    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return false;

    // user.role can be string or object depending what validate() returned.
    // Normalize to string role name
    const userRole =
      typeof user.role === 'string'
        ? user.role
        : (user.role?.name ?? user.role);

    return requiredRoles.includes(userRole);
  }
}
