# Data Model

## Durable entities

- `users`: login identity, public profile and salted password hash.
- `sessions`: hashed opaque session tokens with expiry. Raw tokens only live in HttpOnly cookies.
- `chats`: private, group, channel and saved-message containers.
- `chat_members`: membership, role and per-member permission override boundary.
- `chat_admin_log`: durable audit trail for member, moderation, invite,
  topic and pinned-message admin actions.
- `chat_bans`: active permanent and temporary group/channel bans.
- `chat_invite_links`: revocable invite links with optional expiry, usage
  limits and approval requirements.
- `chat_join_requests`: pending/approved/declined requests created from
  approval-gated invite links.
- `chat_topics`: group topics/threads with pinned and closed states.
- `chat_user_settings`: per-user chat state such as pinned, muted, archived and push mode.
- `push_subscriptions`: Web Push endpoints scoped to one authenticated user.
- `chat_folders` / `chat_folder_chats`: custom folder definitions and chat membership in folders.
- `messages`: AES-256-GCM ciphertext, IV and authentication tag. Plaintext is never stored.
- `polls`, `poll_options`, `poll_votes`: poll definitions and user votes
  tied to message rows.
- `channel_post_stats` / `message_views`: channel view/repost aggregates and
  per-user unique view tracking.
- `message_user_deletions`: per-user hidden messages for delete-for-me.
- `chat_history_clears`: per-user clear-history markers.
- `calls`: call chat, initiator, type and lifecycle status.
- `call_participants`: per-user call state, mute/camera/screen-share flags,
  join/leave timestamps and reconnect state. SDP/ICE signaling is transient
  and not stored.
- `security_events`: user-visible security alerts such as suspicious logins and key-change warnings.
- `user_blocks`: backend-enforced direct user blocks.
- `reports`: user/message/chat reports for moderation review.
- `user_key_changes`: encryption public-key change history used for warning generation.

## Access rules

- A user may read or write messages only when `chat_members` contains that user and chat.
- Group/channel writes are also gated by role-derived granular permissions,
  active bans and slow mode.
- Channel members can subscribe/read; channel posting and stats require admin
  permissions.
- Scheduled messages are stored with `scheduled_at` and no `sent_at`; normal
  message history excludes them until publication.
- Per-user chat settings, folders, delete-for-me and clear-history rows are scoped by both `user_id` and chat membership.
- A call signal is routed only when the authenticated sender is one of the stored call participants.
- Direct private chat creation, message sending, media upload and calls are blocked when either user has blocked the other.
- Reports can target a visible user, visible message or chat. Message reports require the reporter to be a chat member.
- User search excludes the current user and returns public profile fields only.
- Server-side message search is limited to rows with explicit `messages.search_text`.
  The default encrypted client flow does not expose plaintext search text to the server.

## Security boundary

- Passwords are one-way `scrypt` hashes with unique random salts.
- Session cookies are `HttpOnly` and `SameSite=Lax`; the database stores only SHA-256 token hashes.
- Messages are encrypted at rest with AES-256-GCM and a key outside the database.
- Production must provide `MESSAGE_ENCRYPTION_KEY` and HTTPS/WSS.
- The browser-side encryption helpers wrap message/media content keys for
  recipients, but they do not provide audited secret chats, device verification,
  multi-device key rotation or hardened key backup/recovery.
- Public-key changes create warning events for the account owner and users who share chats with that account.
- WebRTC media encryption uses DTLS-SRTP when real peer connections are connected. This backend currently implements signaling, not a claim of audited end-to-end call encryption.
