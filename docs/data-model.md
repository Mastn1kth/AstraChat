# Data Model

## Durable entities

- `users`: login identity, public profile and salted password hash.
- `sessions`: hashed opaque session tokens with expiry. Raw tokens only live in HttpOnly cookies.
- `chats`: private, group, channel and saved-message containers.
- `chat_members`: membership and role ownership boundary.
- `chat_user_settings`: per-user chat state such as pinned, muted and archived.
- `chat_folders` / `chat_folder_chats`: custom folder definitions and chat membership in folders.
- `messages`: AES-256-GCM ciphertext, IV and authentication tag. Plaintext is never stored.
- `message_user_deletions`: per-user hidden messages for delete-for-me.
- `chat_history_clears`: per-user clear-history markers.
- `calls`: call participants, type and lifecycle status. SDP/ICE signaling is transient and not stored.

## Access rules

- A user may read or write messages only when `chat_members` contains that user and chat.
- Per-user chat settings, folders, delete-for-me and clear-history rows are scoped by both `user_id` and chat membership.
- A call signal is routed only when the authenticated sender is one of the stored call participants.
- User search excludes the current user and returns public profile fields only.
- Server-side message search is limited to rows with explicit `messages.search_text`.
  The default encrypted client flow does not expose plaintext search text to the server.

## Security boundary

- Passwords are one-way `scrypt` hashes with unique random salts.
- Session cookies are `HttpOnly` and `SameSite=Lax`; the database stores only SHA-256 token hashes.
- Messages are encrypted at rest with AES-256-GCM and a key outside the database.
- Production must provide `MESSAGE_ENCRYPTION_KEY` and HTTPS/WSS.
- WebRTC media encryption uses DTLS-SRTP when real peer connections are connected. This backend currently implements signaling, not a claim of audited end-to-end call encryption.
