# Stream Chat Flow (Live Comments)

## Overview
The Stream Chat system is designed for real-time interactions tied to a specific **Video** or **Live Stream**. It allows viewers to comment on content as it happens or on recorded VODs.

## Data Model
- **Identifier**: `videoId` (linked to the `Content` model).
- **Storage**: `LiveComment` table.
- **Hierarchical Support**: Supports replies (threading) via `parentId`.

## WebSocket Flow (`/ws/live`)
1. **Connection**: Client connects to `wss://api.rappio.tv/ws/live`.
2. **Joining**: Client emits `join_video` with `{ videoId: string, userId?: string }`.
3. **Room Management**: The server joins the socket to a room named `video:${videoId}`.
4. **Sending a Comment**:
   - Client emits `send_comment` with `{ videoId, userId, message, replyToId? }`.
5. **Events**:
   - `new_comment`: Broadcasted to everyone in the room when a comment is posted (Standardized).
   - `comment.created`: (Legacy/Alias) Same as `new_comment`.
   - `comment.updated`: Broadcasted when a comment is edited.
   - `comment.deleted`: Broadcasted when a moderator or owner deletes a comment.
   - `live_stats_update`: Broadcasted every 10 seconds with current viewer counts for that video.

## API Endpoints
- `GET /live-comments/:videoId`: Fetches paginated legacy comments for the video.
- `POST /live-comments`: Creates a new comment. Requires `videoId` and `message`.
- `PATCH /live-comments/:id`: Updates an existing comment.
- `DELETE /live-comments/:id`: Deletes a comment.

## Logic & Security
- **Moderation**: Checks if the user is banned from the channel before allowing a comment.
- **Account Age Gate**: Users must have an account older than 15 minutes to post (unless they are the owner or a moderator).
- **Role Detection**: Automatically identifies if the poster is the `OWNER`, a `MODERATOR`, or a regular `USER`.
