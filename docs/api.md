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
- `GET /api/security/events` - list recent security alerts.
- `GET /api/security/events?unread=true` - list unread security alerts.
- `POST /api/security/events/read` - mark all security alerts as read.
- `POST /api/security/events/:eventId/read` - mark one security alert as read.

## Users

- `GET /api/users?search=` - search public users, excluding the current user.
- `PATCH /api/users/me/profile` - update name, username and bio.
- `PATCH /api/users/me/encryption-key` - store the current client public key.
- `GET /api/users/blocks` - list users blocked by the current user.
- `POST /api/users/:userId/block` - block a user for direct chats, calls and media sends.
- `DELETE /api/users/:userId/block` - unblock a user.
- `POST /api/users/me/avatar` - upload avatar image.
- `DELETE /api/users/me/avatar` - remove avatar.
- `GET /api/users/:userId/avatar` - fetch avatar.
- `DELETE /api/users/me` - delete account.

## Chats

- `GET /api/chats` - list chats where the current user is a member.
  Each chat includes `members` and per-user `settings`:
  `pinned`, `pinnedAt`, `muted`, `mutedUntil`, `archived`, `archivedAt`,
  `pushMode`.
- `POST /api/chats` - create private, group or channel chat.
- `PATCH /api/chats/:chatId/settings` - update per-user chat state.
  Body fields are optional: `pinned`, `muted`, `mutedUntil`, `archived`,
  `pushMode`.
- `GET /api/chats/:chatId/members` - list group/channel members with roles
  and resolved permissions.
- `POST /api/chats/:chatId/members` - add a member. Requires
  `manage_members`.
- `DELETE /api/chats/:chatId/members/:userId` - leave or kick a member.
  Kicking requires `manage_members`.
- `PATCH /api/chats/:chatId/members/:userId/role` - set role
  `owner`, `admin`, `moderator` or `member`, plus optional permission
  overrides. Requires `manage_roles`.
- `PATCH /api/chats/:chatId/members/:userId/permissions` - replace granular
  member permission overrides. Requires `manage_roles`.
- `PATCH /api/chats/:chatId/moderation` - update slow mode and default
  permissions. Requires `manage_chat`.
- `GET /api/chats/:chatId/admin-log` - list moderation/admin events.
  Requires `manage_chat`.

## Moderation

- `GET /api/chats/:chatId/bans` - list active bans. Requires `ban_users`.
- `POST /api/chats/:chatId/bans` - ban or temp-ban a user. Body:
  `userId`, optional `reason`, optional `durationSeconds`. Requires
  `ban_users`.
- `DELETE /api/chats/:chatId/bans/:userId` - unban a user. Requires
  `ban_users`.

## Invites and Join Requests

- `GET /api/chats/:chatId/invites` - list invite links. Requires
  `invite_users`.
- `POST /api/chats/:chatId/invites` - create invite link. Body: optional
  `name`, `expiresAt`, `usageLimit`, `requireApproval`. Requires
  `invite_users`.
- `DELETE /api/chats/:chatId/invites/:inviteId` - revoke invite link.
- `POST /api/invites/:token/join` - join by invite or create a pending join
  request when approval is enabled.
- `GET /api/chats/:chatId/join-requests` - list pending requests. Requires
  `approve_join_requests`.
- `POST /api/chats/:chatId/join-requests/:userId` - approve or decline.
  Body: `approved`.

## Topics

- `GET /api/chats/:chatId/topics` - list group topics.
- `POST /api/chats/:chatId/topics` - create topic. Requires
  `manage_topics`.
- `PATCH /api/chats/:chatId/topics/:topicId` - update title, pinned or
  closed state. Requires `manage_topics`.

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
- `GET /api/chats/:chatId/messages/:messageId/context` - load a bounded,
  visible history window around a specific message for jump-to-message. It
  applies the same per-user delete-for-me and clear-history visibility checks,
  and refuses deleted-for-everyone targets.
- `POST /api/chats/:chatId/messages` - send a message.
  Body: `text`, optional `mediaId`, `replyToId`, `forwardedFromMessageId`,
  optional `searchText`, `topicId`, `silent`, `scheduledAt`, and optional
  `poll`.
- `PATCH /api/chats/:chatId/messages/:messageId` - edit own message.
- `DELETE /api/chats/:chatId/messages/:messageId` - delete own message for
  everyone, or any message when the actor has `delete_messages`.
- `POST /api/chats/:chatId/messages/:messageId/delete-for-me` - hide one
  message only for the current user.
- `POST /api/chats/:chatId/clear-history` - hide all current chat history only
  for the current user.
- `POST /api/chats/:chatId/messages/:messageId/reactions` - toggle reaction.

## Reports

- `POST /api/reports` - create a moderation/security report.
  Body: optional `targetUserId`, optional `targetMessageId`, optional `chatId`,
  `reason` (`spam`, `abuse`, `impersonation`, `security`, `other`) and optional
  `details`.
- `GET /api/chats/:chatId/scheduled-messages` - list pending scheduled
  messages visible to the current user/admin.
- `POST /api/chats/:chatId/scheduled-messages/:messageId/send-now` - publish
  scheduled message immediately.
- `DELETE /api/chats/:chatId/scheduled-messages/:messageId` - delete pending
  scheduled message.
- `POST /api/chats/:chatId/messages/:messageId/poll-votes` - vote in a poll.
  Body: `optionIds`.

## Channels

- `POST /api/chats/:chatId/messages/:messageId/view` - count a unique channel
  post view for the current user.
- `GET /api/chats/:chatId/channel-stats` - aggregate subscribers, posts,
  views and reposts. Requires `view_stats`.

## Search

- `GET /api/search?q=` - global search across users, chats and searchable
  message rows.
- `GET /api/chats/:chatId/search?q=` - search inside one chat.

Message search is intentionally limited by encryption. The product choice here
is to keep server-side message search limited to rows where the client
deliberately provides `searchText`, instead of building a plaintext searchable
server index. The current client sends client-encrypted message envelopes to
the server, so the server should not rely on plaintext message bodies being
available. This is not a claim of a full audited messaging protocol. Rows without
`searchText` are not searchable through the server; the UI must say this
honestly instead of presenting full encrypted-history search.

## Media

- `POST /api/media` - upload image, video, voice or file media.
- `GET /api/media/:mediaId` - download media if the user belongs to the chat.

## Calls and WebSocket

- `GET /api/calls` - return call history for the current user. Optional `chatId`
  filters to one chat.
- `GET /api/calls/ice-servers` - return configured WebRTC STUN/TURN servers.
- `POST /api/calls` - create a private or group call record and notify
  available participants.
- `GET /api/health` - health check.
- WebSocket events include `typing`, `chat:read`, `message:new`,
  `message:delivered`, `message:read`, `message:edited`, `message:deleted`,
  `message:reactions`, `chat:settings`, `presence:update`, and call signaling
  events. Call events include `call:incoming`, `call:join`,
  `call:participant`, `call:participant-state`, `call:offer`, `call:answer`,
  `call:ice`, `call:decline` and `call:hangup`.
