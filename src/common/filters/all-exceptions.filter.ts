import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const type = host.getType();

    if (type === 'http') {
      const ctx = host.switchToHttp();

      const httpStatus =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

      const message =
        exception instanceof HttpException
          ? exception.getResponse()
          : (exception as any)?.message || 'Internal server error';

      const responseBody = {
        success: false,
        statusCode: httpStatus,
        timestamp: new Date().toISOString(),
        path: httpAdapter.getRequestUrl(ctx.getRequest()),
        message: message,
      };

      const response = message ? message : responseBody;

      this.logger.error(
        `HTTP Exception: ${JSON.stringify(message)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );

      httpAdapter.reply(ctx.getResponse(), response, httpStatus);
    } else if (type === 'ws') {
      const ctx = host.switchToWs();
      const client = ctx.getClient();
      // const data = ctx.getData(); // Optional: Log payload usually

      this.logger.error(
        `WebSocket Exception`,
        exception instanceof Error ? exception.stack : String(exception),
      );

      // Prevent crash by just logging. You might want to emit an error to the client.
      try {
        client.emit('error', (exception as any)?.message ? exception : {
          message: (exception as any)?.message || 'Internal server error',
          success: false,
        });
      } catch (e) {
        this.logger.error('Failed to emit error to WS client', e);
      }
    } else {
      this.logger.error(
        `Unknown Context Exception (${type})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
  }
}
