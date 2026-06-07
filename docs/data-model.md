# Data Model

## Durable entities

- `users`: login identity, public profile and salted password hash.
- `sessions`: hashed opaque session tokens with expiry. Raw tokens only live in HttpOnly cookies.
- `chats`: private, group, channel and saved-message containers.
- `chat_members`: membership and role ownership boundary.
- `messages`: AES-256-GCM ciphertext, IV and authentication tag. Plaintext is never stored.
- `calls`: call participants, type and lifecycle status. SDP/ICE signaling is transient and not stored.

## Access rules

- A user may read or write messages only when `chat_members` contains that user and chat.
- A call signal is routed only when the authenticated sender is one of the stored call participants.
- User search excludes the current user and returns public profile fields only.

## Security boundary

- Passwords are one-way `scrypt` hashes with unique random salts.
- Session cookies are `HttpOnly` and `SameSite=Lax`; the database stores only SHA-256 token hashes.
- Messages are encrypted at rest with AES-256-GCM and a key outside the database.
- Production must provide `MESSAGE_ENCRYPTION_KEY` and HTTPS/WSS.
- WebRTC media encryption uses DTLS-SRTP when real peer connections are connected. This backend currently implements signaling, not a claim of audited end-to-end call encryption.
