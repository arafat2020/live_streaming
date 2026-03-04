/**
 * @fileoverview User Sanitizer Helper
 *
 * Provides a single utility to strip sensitive fields from a user
 * object before returning it in API responses. This replaces the
 * manual destructure-and-void pattern that was duplicated across
 * multiple services.
 */

/** Fields that must never be exposed in API responses. */
const SENSITIVE_FIELDS = [
  'password',
  'twoFactorSecret',
  'passwordResetToken',
  'passwordResetExpires',
  'refreshToken',
] as const;

/**
 * Strips sensitive fields from a user object.
 *
 * @param user - The raw user object (typically from Prisma).
 * @returns A new object with all sensitive fields removed.
 *
 * @example
 * ```ts
 * const safeUser = sanitizeUser(rawUser);
 * return { user: safeUser, accessToken };
 * ```
 */
export function sanitizeUser<T extends Record<string, any>>(
  user: T,
): Omit<T, (typeof SENSITIVE_FIELDS)[number]> {
  const sanitized = { ...user };
  for (const field of SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}
