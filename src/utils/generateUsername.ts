import { PrismaService } from '../prisma/prisma.service';

/**
 * Generates a unique username from email address
 * Format: baseUsername (cleaned from email) + optional number suffix
 * Examples: john.doe@gmail.com -> johndoe, johndoe1, johndoe2, etc.
 */
export async function generateUniqueUsername(
  email: string,
  prisma: PrismaService,
): Promise<string> {
  // Extract base username from email and clean it
  const baseUsername = email
    .split('@')[0] // Get part before @
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9]/g, '') // Remove special characters
    .substring(0, 20); // Limit to 20 characters for base

  // If base username is empty after cleaning, use a default
  const cleanBase = baseUsername || 'user';

  // Check if base username is available
  const existingUser = await prisma.user.findUnique({
    where: { username: cleanBase },
  });

  if (!existingUser) {
    return cleanBase;
  }

  // Base username is taken, try with numbers
  let counter = 1;
  let username = cleanBase;

  while (counter <= 9999) {
    // Prevent infinite loop
    username = `${cleanBase}${counter}`;

    const userExists = await prisma.user.findUnique({
      where: { username },
    });

    if (!userExists) {
      return username;
    }

    counter++;
  }

  // Fallback: generate random username if all attempts fail
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const fallbackUsername = `${cleanBase}_${randomSuffix}`;

  // Final check for fallback
  const fallbackExists = await prisma.user.findUnique({
    where: { username: fallbackUsername },
  });

  if (!fallbackExists) {
    return fallbackUsername;
  }

  // Last resort: use timestamp
  return `${cleanBase}_${Date.now()}`;
}

/**
 * Validates if a username follows the required format
 * - Only lowercase letters and numbers
 * - 3-30 characters long
 * - No special characters
 */
export function validateUsernameFormat(username: string): boolean {
  const usernameRegex = /^[a-z0-9]{3,30}$/;
  return usernameRegex.test(username);
}

/**
 * Cleans a username string to match the required format
 */
export function cleanUsername(username: string): string {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 30);
}
