/**
 * @fileoverview Mail Configuration Factory
 *
 * Extracts SMTP configuration from environment variables into a dedicated
 * factory function for use with `@nestjs-modules/mailer`. This was previously
 * configured inline in `app.module.ts`.
 *
 * Required environment variables:
 * - `SMTP_HOST` - SMTP server hostname
 * - `SMTP_PORT` - SMTP server port (defaults to 587)
 * - `SMTP_USER` - SMTP authentication username
 * - `SMTP_PASS` - SMTP authentication password
 * - `SMTP_FROM` - Default sender address (defaults to 'noreply@rappio.app')
 */

import { MailerOptions } from '@nestjs-modules/mailer';

/**
 * Creates the MailerModule async configuration options.
 *
 * @returns MailerOptions configured from environment variables.
 */
export function createMailConfig(): MailerOptions {
  return {
    transport: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    defaults: {
      from: process.env.SMTP_FROM || 'noreply@rappio.app',
    },
  };
}
