# Channel Chat Flow (24/7 Persistent Chat)

## Overview
The Channel Chat system is a global, persistent communication hub for a **Channel**. It remains active 24/7, regardless of whether a stream is currently live or even exists.

## Data Model
- **Identifier**: `channelId`.
- **Primary Object**: `ChatRoom`. Each channel has one primary `ChatRoom` with `isGlobal: true` or matched via `channelId`.
- **Storage**: 
  - `ChatRoom`: The room container.
  - `ChatMessage`: Individual messages stored within the room.
  - `ChatParticipant`: Tracks users who have ever joined the room.

## WebSocket Flow (`/ws/chat`)
1. **Connection**: Client connects to `wss://api.rappio.tv/ws/chat`.
2. **Joining**: Client emits `join_room` with the `roomId`.
3. **Room Management**: The server joins the socket to a room named using the `roomId`.
4. **Sending a Message**:
   - Client emits `send_message` with `{ roomId, userId, content, replyToId? }`.
5. **Events**:
   - `new_message`: Broadcasted when a new persistent message is sent to the channel (Standardized).
   - `message`: (Legacy/Alias) Same as `new_message`.
   - `roomCreated`: Broadcasted when a new room is initialized.

## API Endpoints
- `GET /chat/channel/:channelId`: Finds or automatically creates the 24/7 room for a channel.
- `GET /chat/:roomId/messages`: Fetches paginated history for the channel chat.
- `POST /chat/:roomId/messages`: Sends a persistent message. Requires `content` and `userId`.
- `DELETE /chat/message/:id`: (Admin/Mod) Deletes a message from the history.

## Logic & Security
- **Persistence**: Unlike Stream Chat which is content-focused, this chat is community-focused and serves as a continuous record of channel activity.
- **Account Age Gate**: Similar 15-minute gate for new accounts.
- **Moderation Integration**: Shared ban/timeout system with Stream Chat; if a user is banned from the channel, they are restricted from both chats.
