# Security Posture

This project must not be described as a complete end-to-end encrypted messenger
today. It has useful security controls, but the cryptographic protocol and abuse
flows are still MVP-level.

## What exists now

- Passwords are hashed with `scrypt` and random salts.
- Sessions use opaque random tokens; only token hashes are stored server-side.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Message and media rows are encrypted at rest with AES-256-GCM through
  `MESSAGE_ENCRYPTION_KEY`.
- Browser helpers encrypt text and media envelopes with AES-GCM content keys
  wrapped to recipient public keys with RSA-OAEP.
- Active sessions can be listed and terminated.
- Suspicious-login alerts are stored as security events when a new session uses
  a device/network combination not seen in recent active sessions.
- Password change signs out other sessions.
- Users can block other users. The backend enforces blocks for private chat
  creation, direct message sending, direct media upload and calls.
- Users can report users/messages/chats into the `reports` table.
- Encryption public-key changes create warning events for the owner and shared
  chat contacts.
- Auth endpoints have rate limiting, backed by Redis when configured.
- Production mode requires PostgreSQL, Redis, S3-compatible storage, VAPID keys,
  `MESSAGE_ENCRYPTION_KEY` and HTTPS/WSS-capable deployment.

## What must not be claimed yet

- Do not claim that all chats are fully end-to-end encrypted.
- Do not claim Signal/Telegram Secret Chat parity.
- Do not claim cryptographic forward secrecy.
- Do not claim verified device identity.
- Do not claim complete key recovery safety.
- Do not claim production-grade abuse moderation.
- Do not claim audited security.

## Current encryption model

Current normal chats are server-backed cloud chats with client-side encrypted
message/media envelopes where possible and server-side encryption at rest. The
server stores public keys and encrypted payloads, but there is no independent
device verification, no ratchet protocol, no forward secrecy, no key-change
warning flow and no separate secret-chat state machine.

Secret chats should be treated as a future feature. They need a separate protocol
and product surface, not a rename of the current chat flow.

## Missing security flows

- Device verification with fingerprint/safety-number UX.
- Full key rotation. Basic key-change warning events exist, but verified key
  ceremonies do not.
- Recovery/backup that does not casually export raw private keys.
- Separate secret chats with their own lifecycle, membership and deletion rules.
- Admin/moderator report review UI.
- Moderator/admin review queues and audit logs.
- Broader rate limits for messages, media uploads, search, invites and reports.
- Security flow tests for auth, sessions, encryption fallback and moderation.

## Next implementation order

1. Add admin/moderator review for the existing report records.
2. Add device verification and safety-number UX.
3. Replace raw private-key export with hardened recovery.
4. Design secret chats as a separate protocol with explicit threat model,
   test vectors and external review.
