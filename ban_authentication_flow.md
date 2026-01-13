# User Ban System - Authentication Flow

## Overview
The ban system prevents banned users from accessing the platform at multiple authentication checkpoints. This document explains how banned users are blocked from logging in and accessing protected resources.

## Ban Enforcement Points

### 1. **Login (`POST /auth/login`)**
When a user attempts to log in, the system:
- ✅ Checks if `user.isBanned` is `true`
- ✅ Automatically unbans users whose temporary ban has expired
- ✅ Throws appropriate error messages for active bans

**Permanent Ban Response:**
```json
{
  "statusCode": 401,
  "message": "Your account has been permanently banned for: [reason]. Please contact support for more information.",
  "banType": "PERMANENT",
  "reason": "[reason]"
}
```

**Temporary Ban Response:**
```json
{
  "statusCode": 401,
  "message": "Your account has been temporarily banned for: [reason].",
  "banType": "TEMPORARY",
  "expiresAt": "2026-01-20T12:00:00.000Z",
  "reason": "[reason]"
}
```

### 2. **Token Refresh (`POST /auth/refresh`)**
When a user tries to refresh their access token:
- ✅ Checks if `user.isBanned` is `true`
- ✅ Automatically unbans expired temporary bans
- ✅ Prevents banned users from obtaining new tokens

This ensures that even if a user was banned while they had a valid refresh token, they cannot continue accessing the platform.

### 3. **Token Validation (WebSocket & Protected Routes)**
The `validateToken` method is used for:
- WebSocket connections (chat, live streams)
- Protected API endpoints
- Real-time features

It performs the same ban checks:
- ✅ Checks if `user.isBanned` is `true`
- ✅ Automatically unbans expired temporary bans
- ✅ Returns `null` for banned users (denying access)

## Automatic Temporary Ban Expiration

The system automatically handles temporary ban expiration:

```typescript
if (user.isBanned && user.banExpiresAt && user.banExpiresAt < new Date()) {
  // Auto-unban expired temporary bans
  await prisma.user.update({
    where: { id: user.id },
    data: {
      isBanned: false,
      banExpiresAt: null,
      banReason: null,
    },
  });
}
```

This means:
- Users with expired temporary bans are automatically unbanned when they try to log in
- No manual intervention required
- Ban logs are preserved for audit purposes

## Ban Types

### Permanent Ban
- `isBanned: true`
- `banExpiresAt: null`
- User cannot log in until manually unbanned by an admin

### Temporary Ban
- `isBanned: true`
- `banExpiresAt: [future date]`
- User is automatically unbanned after the expiration date

## Admin Ban Management Endpoints

### Ban a User
```http
POST /admin/ban/:userId
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "banType": "TEMPORARY",
  "reason": "Spamming in chat",
  "durationInDays": 7
}
```

### Unban a User
```http
POST /admin/ban/:userId/unban
Authorization: Bearer <admin_token>
```

### Search Users (to find users to ban)
```http
GET /admin/ban/search?q=email@example.com&page=1&limit=10
Authorization: Bearer <admin_token>
```

### List All Banned Users
```http
GET /admin/ban/list?page=1&limit=10
Authorization: Bearer <admin_token>
```

## Database Schema

The ban system uses the following fields in the `User` model:

```prisma
model User {
  id            String    @id @default(uuid())
  email         String    @unique
  isBanned      Boolean   @default(false)
  banExpiresAt  DateTime?
  banReason     String?
  // ... other fields
}

model PlatformBanLog {
  id        String   @id @default(uuid())
  userId    String
  adminId   String
  banType   BanType
  reason    String?
  expiresAt DateTime?
  createdAt DateTime @default(now())
  
  user      User     @relation("BannedUser", fields: [userId], references: [id])
  admin     User     @relation("BanAdmin", fields: [adminId], references: [id])
}

enum BanType {
  PERMANENT
  TEMPORARY
}
```

## Security Considerations

1. **Multiple Checkpoints**: Ban checks are performed at login, token refresh, and token validation
2. **Audit Trail**: All bans are logged in `PlatformBanLog` with admin ID and timestamp
3. **Automatic Cleanup**: Expired temporary bans are automatically removed
4. **Clear Messaging**: Users receive specific error messages explaining their ban status
5. **Admin Only**: Only users with `ADMIN` role can ban/unban users

## Testing the Ban System

### Test Scenario 1: Permanent Ban
1. Admin bans user with `banType: "PERMANENT"`
2. User tries to log in → Receives 401 error with permanent ban message
3. User tries to refresh token → Receives 401 error
4. User tries to connect via WebSocket → Connection rejected

### Test Scenario 2: Temporary Ban
1. Admin bans user with `banType: "TEMPORARY"`, `durationInDays: 1`
2. User tries to log in → Receives 401 error with expiration date
3. Wait for ban to expire (or manually update `banExpiresAt` to past date)
4. User tries to log in → Successfully logged in, ban automatically removed

### Test Scenario 3: Manual Unban
1. Admin bans user
2. User cannot log in
3. Admin unbans user via `POST /admin/ban/:userId/unban`
4. User can now log in successfully

## Error Handling

All ban-related errors use `UnauthorizedException` with descriptive messages:

```typescript
// Permanent ban
throw new UnauthorizedException(
  `Your account has been permanently banned for: ${reason}. Please contact support.`
);

// Temporary ban
throw new UnauthorizedException(
  `Your account has been temporarily banned for: ${reason}. Ban expires at: ${expiresAt}`
);
```

## Client-Side Handling

When the client receives a 401 error during login or token refresh:

```typescript
try {
  const response = await fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    if (error.message.includes('banned')) {
      // Show ban message to user
      showBanNotification(error.message);
      // Redirect to banned page or logout
    }
  }
} catch (error) {
  // Handle error
}
```

## Future Enhancements

Potential improvements to consider:
- Email notification when a user is banned/unbanned
- Appeal system for banned users
- IP-based bans for severe violations
- Graduated ban system (warnings → temporary → permanent)
- Ban history visible to admins
- Bulk ban operations
