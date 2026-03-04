/**
 * @fileoverview Shadow Ban Filter Helper
 *
 * Builds a reusable Prisma `where` clause for content visibility
 * that respects shadow-ban rules. This filter was duplicated 5+
 * times across `content.service.ts` methods (findAll, liveOnRappioList,
 * getHeroBannerContent, getHomeCategorizedStreams, findOne).
 *
 * Visibility Rules:
 * - Anonymous users: only see non-shadow-banned content
 * - Regular users:   see non-shadow-banned content + their own content
 * - Admins:          see everything (including shadow-banned content)
 */

import { Prisma } from '@prisma/client';

/**
 * Builds a Prisma `ContentWhereInput` fragment that enforces shadow-ban
 * visibility rules based on the requesting user's identity and role.
 *
 * @param userId  - The authenticated user's ID, or `undefined` for anonymous.
 * @param isAdmin - Whether the requesting user has the ADMIN role.
 * @returns A `ContentWhereInput` object to merge into existing `where` clauses.
 *
 * @example
 * ```ts
 * const visibilityFilter = buildShadowBanFilter(userId, isAdmin);
 * const content = await prisma.content.findMany({
 *   where: { status: 'AVAILABLE', ...visibilityFilter },
 * });
 * ```
 */
export function buildShadowBanFilter(
  userId?: string,
  isAdmin?: boolean,
): Prisma.ContentWhereInput {
  if (!userId) {
    // Anonymous user: only non-shadow-banned content
    return {
      isShadowBanned: false,
      channel: { owner: { isShadowBanned: false } },
    };
  }

  // Authenticated user: see non-banned content + own content (+ everything if admin)
  const orConditions: Prisma.ContentWhereInput[] = [
    {
      isShadowBanned: false,
      channel: { owner: { isShadowBanned: false } },
    },
    { channel: { ownerId: userId } },
  ];

  if (isAdmin) {
    orConditions.push({
      OR: [
        { isShadowBanned: true },
        { channel: { owner: { isShadowBanned: true } } },
      ],
    });
  }

  return { AND: [{ OR: orConditions }] };
}
