/**
 * Ban System Test Examples
 *
 * This file contains example requests to test the ban system.
 * Use these with tools like Postman, Thunder Client, or curl.
 */

// ============================================
// 1. SEARCH FOR USERS TO BAN
// ============================================

/**
 * Search for users by email, name, or ID
 * GET /admin/ban/search
 */
const searchUsersExample = {
  method: 'GET',
  url: 'http://localhost:3000/admin/ban/search?q=user@example.com&page=1&limit=10',
  headers: {
    Authorization: 'Bearer <ADMIN_ACCESS_TOKEN>',
    'Content-Type': 'application/json',
  },
};

// ============================================
// 2. BAN A USER (PERMANENT)
// ============================================

/**
 * Issue a permanent ban
 * POST /admin/ban/:userId
 */
const permanentBanExample = {
  method: 'POST',
  url: 'http://localhost:3000/admin/ban/USER_ID_HERE',
  headers: {
    Authorization: 'Bearer <ADMIN_ACCESS_TOKEN>',
    'Content-Type': 'application/json',
  },
  body: {
    banType: 'PERMANENT',
    reason: 'Repeated violations of community guidelines',
  },
};

// ============================================
// 3. BAN A USER (TEMPORARY - 7 DAYS)
// ============================================

/**
 * Issue a temporary ban using durationInDays
 * POST /admin/ban/:userId
 */
const temporaryBanWithDurationExample = {
  method: 'POST',
  url: 'http://localhost:3000/admin/ban/USER_ID_HERE',
  headers: {
    Authorization: 'Bearer <ADMIN_ACCESS_TOKEN>',
    'Content-Type': 'application/json',
  },
  body: {
    banType: 'TEMPORARY',
    reason: 'Spamming in chat',
    durationInDays: 7,
  },
};

// ============================================
// 4. BAN A USER (TEMPORARY - SPECIFIC DATE)
// ============================================

/**
 * Issue a temporary ban with specific expiration date
 * POST /admin/ban/:userId
 */
const temporaryBanWithDateExample = {
  method: 'POST',
  url: 'http://localhost:3000/admin/ban/USER_ID_HERE',
  headers: {
    Authorization: 'Bearer <ADMIN_ACCESS_TOKEN>',
    'Content-Type': 'application/json',
  },
  body: {
    banType: 'TEMPORARY',
    reason: 'Inappropriate content',
    expiresAt: '2026-01-20T00:00:00.000Z',
  },
};

// ============================================
// 5. UNBAN A USER
// ============================================

/**
 * Manually unban a user
 * POST /admin/ban/:userId/unban
 */
const unbanUserExample = {
  method: 'POST',
  url: 'http://localhost:3000/admin/ban/USER_ID_HERE/unban',
  headers: {
    Authorization: 'Bearer <ADMIN_ACCESS_TOKEN>',
    'Content-Type': 'application/json',
  },
};

// ============================================
// 6. LIST ALL BANNED USERS
// ============================================

/**
 * Get paginated list of all banned users
 * GET /admin/ban/list
 */
const listBannedUsersExample = {
  method: 'GET',
  url: 'http://localhost:3000/admin/ban/list?page=1&limit=10',
  headers: {
    Authorization: 'Bearer <ADMIN_ACCESS_TOKEN>',
    'Content-Type': 'application/json',
  },
};

// ============================================
// 7. TEST BANNED USER LOGIN (WILL FAIL)
// ============================================

/**
 * Try to login as a banned user
 * POST /auth/login
 *
 * Expected Response (Permanent Ban):
 * {
 *   "statusCode": 401,
 *   "message": "Your account has been permanently banned for: [reason]. Please contact support for more information."
 * }
 *
 * Expected Response (Temporary Ban):
 * {
 *   "statusCode": 401,
 *   "message": "Your account has been temporarily banned for: [reason]. Ban expires at: 2026-01-20T00:00:00.000Z"
 * }
 */
const bannedUserLoginExample = {
  method: 'POST',
  url: 'http://localhost:3000/auth/login',
  headers: {
    'Content-Type': 'application/json',
  },
  body: {
    email: 'banned-user@example.com',
    password: 'password123',
  },
};

// ============================================
// CURL EXAMPLES
// ============================================

/**
 * Search for users (curl)
 */
const curlSearchUsers = `
curl -X GET "http://localhost:3000/admin/ban/search?q=user@example.com&page=1&limit=10" \\
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \\
  -H "Content-Type: application/json"
`;

/**
 * Ban user permanently (curl)
 */
const curlPermanentBan = `
curl -X POST "http://localhost:3000/admin/ban/USER_ID_HERE" \\
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "banType": "PERMANENT",
    "reason": "Repeated violations of community guidelines"
  }'
`;

/**
 * Ban user temporarily (curl)
 */
const curlTemporaryBan = `
curl -X POST "http://localhost:3000/admin/ban/USER_ID_HERE" \\
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "banType": "TEMPORARY",
    "reason": "Spamming in chat",
    "durationInDays": 7
  }'
`;

/**
 * Unban user (curl)
 */
const curlUnbanUser = `
curl -X POST "http://localhost:3000/admin/ban/USER_ID_HERE/unban" \\
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \\
  -H "Content-Type: application/json"
`;

/**
 * List banned users (curl)
 */
const curlListBannedUsers = `
curl -X GET "http://localhost:3000/admin/ban/list?page=1&limit=10" \\
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \\
  -H "Content-Type: application/json"
`;

/**
 * Test banned user login (curl)
 */
const curlBannedUserLogin = `
curl -X POST "http://localhost:3000/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "banned-user@example.com",
    "password": "password123"
  }'
`;

// ============================================
// TESTING WORKFLOW
// ============================================

/**
 * Complete Testing Workflow:
 *
 * 1. Login as Admin
 *    POST /auth/login with admin credentials
 *    Save the accessToken
 *
 * 2. Search for a user to ban
 *    GET /admin/ban/search?q=user@example.com
 *    Note the user's ID
 *
 * 3. Ban the user (temporary or permanent)
 *    POST /admin/ban/:userId
 *    with appropriate banType and reason
 *
 * 4. Try to login as the banned user
 *    POST /auth/login
 *    Should receive 401 with ban message
 *
 * 5. List all banned users
 *    GET /admin/ban/list
 *    Verify the user appears in the list
 *
 * 6. Unban the user
 *    POST /admin/ban/:userId/unban
 *
 * 7. Try to login as the unbanned user
 *    POST /auth/login
 *    Should succeed and return tokens
 *
 * 8. Test automatic temporary ban expiration
 *    - Ban user with durationInDays: 1
 *    - Manually update banExpiresAt in database to past date
 *    - Try to login
 *    - Should succeed and automatically unban
 */

export {
  searchUsersExample,
  permanentBanExample,
  temporaryBanWithDurationExample,
  temporaryBanWithDateExample,
  unbanUserExample,
  listBannedUsersExample,
  bannedUserLoginExample,
  curlSearchUsers,
  curlPermanentBan,
  curlTemporaryBan,
  curlUnbanUser,
  curlListBannedUsers,
  curlBannedUserLogin,
};
