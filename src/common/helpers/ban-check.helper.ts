/**
 * @fileoverview Ban Check Helper
 *
 * Provides a reusable function to validate a user's ban status and
 * auto-unban users whose temporary bans have expired. This logic was
 * previously duplicated in `processUserLogin`, `refreshTokens`, and
 * `validateToken` within auth.service.ts.
 */

import { UnauthorizedException } from '@nestjs/common';
import { BanType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Minimal user shape required for ban checking. */
interface BannableUser {
  id: string;
  isBanned: boolean;
  banExpiresAt: Date | null;
  banReason: string | null;
}

/**
 * Checks whether a user is currently banned. If a temporary ban has
 * expired, the ban is automatically lifted in the database.
 *
 * @param user   - User record with ban-related fields.
 * @param prisma - PrismaService for database updates.
 * @returns `true` if the user is NOT banned (safe to proceed),
 *          throws `UnauthorizedException` if still banned.
 *
 * @throws {UnauthorizedException} When the user is actively banned.
 *
 * @example
 * ```ts
 * await checkAndHandleBan(user, this.prisma);
 * // If we reach here, user is not banned
 * ```
 */
export async function checkAndHandleBan(
  user: BannableUser,
  prisma: PrismaService,
): Promise<boolean> {
  if (!user.isBanned) {
    return true;
  }

  // Auto-unban expired temporary bans
  if (user.banExpiresAt && user.banExpiresAt < new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isBanned: false,
        banExpiresAt: null,
        banReason: null,
      },
    });
    return true;
  }

  // User is still banned — throw with ban details
  const banReason = user.banReason || 'Rule violation';

  if (user.banExpiresAt) {
    throw new UnauthorizedException({
      message: `Your account has been temporarily banned for: ${banReason}.`,
      banType: BanType.TEMPORARY,
      expiresAt: user.banExpiresAt,
      reason: banReason,
    });
  } else {
    throw new UnauthorizedException({
      message: `Your account has been permanently banned for: ${banReason}.`,
      banType: BanType.PERMANENT,
      reason: banReason,
    });
  }
}
