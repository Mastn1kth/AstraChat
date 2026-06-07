# AstraChat API

All API routes are under `/api`. Authenticated routes require the `astrachat_session`
HttpOnly cookie.

## Auth

- `POST /api/auth/register` - create user and session.
- `POST /api/auth/login` - create session.
- `POST /api/auth/logout` - destroy current session.
- `GET /api/auth/me` - return current user.
- `POST /api/auth/change-password` - change password and remove other sessions.
- `GET /api/sessions` - list active sessions.
- `DELETE /api/sessions` - terminate other sessions.
- `DELETE /api/sessions/:sessionId` - terminate one session.

## Users

- `GET /api/users?search=` - search public users, excluding the current user.
- `PATCH /api/users/me/profile` - update name, username and bio.
- `PATCH /api/users/me/encryption-key` - store the current client public key.
- `POST /api/users/me/avatar` - upload avatar image.
- `DELETE /api/users/me/avatar` - remove avatar.
- `GET /api/users/:userId/avatar` - fetch avatar.
- `DELETE /api/users/me` - delete account.

## Chats

- `GET /api/chats` - list chats where the current user is a member.
  Each chat includes `members` and per-user `settings`:
  `pinned`, `pinnedAt`, `muted`, `mutedUntil`, `archived`, `archivedAt`.
- `POST /api/chats` - create private, group or channel chat.
- `PATCH /api/chats/:chatId/settings` - update per-user chat state.
  Body fields are optional: `pinned`, `muted`, `mutedUntil`, `archived`.

## Folders

- `GET /api/chat-folders` - return system folders and custom folders.
  System folders are computed: All, Unread, Personal, Groups, Channels,
  Bots, Archived.
- `POST /api/chat-folders` - create a custom folder.
  Body: `title`, optional `icon`, optional `chatIds`.
- `PATCH /api/chat-folders/:folderId` - update title/icon and replace chat list.
- `DELETE /api/chat-folders/:folderId` - delete a custom folder.
- `PATCH /api/chat-folders/:folderId/chats/:chatId` - update chat state inside
  a custom folder. Body: `pinned`.

## Messages

- `GET /api/chats/:chatId/messages` - load visible message history for the
  current user. It excludes messages hidden by delete-for-me and messages before
  that user's latest clear-history point.
- `POST /api/chats/:chatId/messages` - send a message.
  Body: `text`, optional `mediaId`, `replyToId`, `forwardedFromMessageId`,
  optional `searchText`.
- `PATCH /api/chats/:chatId/messages/:messageId` - edit own message.
- `DELETE /api/chats/:chatId/messages/:messageId` - delete own message for everyone.
- `POST /api/chats/:chatId/messages/:messageId/delete-for-me` - hide one
  message only for the current user.
- `POST /api/chats/:chatId/clear-history` - hide all current chat history only
  for the current user.
- `POST /api/chats/:chatId/messages/:messageId/reactions` - toggle reaction.

## Search

- `GET /api/search?q=` - global search across users, chats and searchable
  message rows.
- `GET /api/chats/:chatId/search?q=` - search inside one chat.

Message search is intentionally limited by encryption. The current client sends
end-to-end encrypted message envelopes to the server, so the server cannot read
plaintext. Message search works only for rows where the client deliberately
provides `searchText`; otherwise the server returns users and chats but cannot
claim full message-content search.

## Media

- `POST /api/media` - upload image, video, voice or file media.
- `GET /api/media/:mediaId` - download media if the user belongs to the chat.

## Calls and WebSocket

- `POST /api/calls` - create call record and notify recipient.
- `GET /api/health` - health check.
- WebSocket events include `typing`, `chat:read`, `message:new`,
  `message:delivered`, `message:read`, `message:edited`, `message:deleted`,
  `message:reactions`, `chat:settings`, `presence:update`, and call signaling
  events.
