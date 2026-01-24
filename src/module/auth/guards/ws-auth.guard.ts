import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService } from '../auth.service';

@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient<Socket>();

    // Preferred: token in handshake.auth (Socket.IO v4)
    const authToken = client.handshake?.auth?.token;
    console.log('[ws-auth.guard] authToken---------------->', authToken);
    // Fallback: token in query (older clients)
    const queryToken = client.handshake?.query?.token;
    const rawToken =
      typeof authToken === 'string'
        ? authToken
        : typeof queryToken === 'string'
          ? queryToken
          : null;

    this.logger.debug(
      `Socket(${client.id}) - authTokenPresent=${!!authToken} queryTokenPresent=${!!queryToken}`,
    );

    if (!rawToken) {
      this.logger.warn(`Socket(${client.id}) no token provided`);
      throw new UnauthorizedException('Unauthorized');
    }

    // validate token using your AuthService helper you added earlier
    const user = await this.authService.validateToken(rawToken);

    if (!user || !user.id) {
      this.logger.warn(`Socket(${client.id}) token invalid or user missing id`);
      throw new UnauthorizedException('Unauthorized');
    }

    // attach sanitized user to socket.data
    client.data.user = user;
    this.logger.log(`Socket(${client.id}) authenticated as user ${user.id}`);
    return true;
  }
}
