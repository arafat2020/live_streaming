/**
 * @fileoverview Token Helper
 *
 * Centralizes JWT access-token and refresh-token generation logic.
 * Previously, identical sign() calls with the same secret fallbacks
 * and expiry values were duplicated 4 times across auth.service.ts.
 */

import { JwtService } from '@nestjs/jwt';

/** Payload shape used for all JWT tokens in this application. */
export interface TokenPayload {
  /** User ID (subject claim). */
  sub: string;
  /** User email. */
  email: string;
  /** User role (e.g. ADMIN, CREATOR, USER). */
  role: string;
  /** Two-factor authentication flag. `true` = 2FA satisfied or not required. */
  tf: boolean;
}

/**
 * Generates a JWT access token.
 *
 * @param jwtService - NestJS JwtService instance.
 * @param payload   - Token payload containing user identity claims.
 * @returns Signed JWT access token string.
 */
export function generateAccessToken(
  jwtService: JwtService,
  payload: TokenPayload,
): string {
  return jwtService.sign(payload, {
    secret: process.env.JWT_SECRET || 'replace_with_a_strong_secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  });
}

/**
 * Generates a JWT refresh token.
 *
 * @param jwtService - NestJS JwtService instance.
 * @param payload   - Token payload containing user identity claims.
 * @returns Signed JWT refresh token string.
 */
export function generateRefreshToken(
  jwtService: JwtService,
  payload: TokenPayload,
): string {
  return jwtService.sign(payload, {
    secret:
      process.env.JWT_REFRESH_SECRET ||
      process.env.JWT_SECRET ||
      'replace_with_a_strong_secret',
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  });
}

/**
 * Generates a short-lived temporary token for 2FA verification.
 *
 * @param jwtService - NestJS JwtService instance.
 * @param payload   - Token payload (tf should be false for temp tokens).
 * @returns Signed JWT temporary token string.
 */
export function generateTempToken(
  jwtService: JwtService,
  payload: TokenPayload,
): string {
  return jwtService.sign(payload, {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.TEMP_JWT_EXPIRES_IN ?? '5m',
  });
}
