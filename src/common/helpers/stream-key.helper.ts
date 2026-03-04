/**
 * @fileoverview Stream Key Helper
 *
 * Generates cryptographically unique stream keys for RTMP ingest.
 * Previously duplicated as a private method in both `auth.service.ts`
 * and `channel.service.ts`.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a 64-character hexadecimal stream key by concatenating
 * two UUIDs with hyphens removed.
 *
 * @returns A unique stream key string (64 hex characters).
 *
 * @example
 * ```ts
 * const key = generateStreamKey();
 * // => "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
 * ```
 */
export function generateStreamKey(): string {
  return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
}
