# AstraChat Roadmap

This roadmap is based on the source prompt and the current codebase state.

## Phase 0 - Project Hygiene

- [x] Add the original product prompt to the repository.
- [x] Replace the default Vite README with project documentation.
- [x] Add a staged roadmap.
- [x] Ignore local database/runtime folders in git.
- [x] Fix current lint errors.
- [ ] Add a real git remote and push the first commit.
- [ ] Add screenshots or a short demo GIF to README.

## Phase 1 - Stable MVP

Goal: make the existing messenger core reliable locally.

- [x] Auth screen.
- [x] Login/register with backend sessions.
- [x] Active session management.
- [x] Profile editing.
- [x] Avatar upload/delete.
- [x] Private chat creation.
- [x] Text message send/edit/delete.
- [x] Replies.
- [x] Reactions.
- [x] Read status.
- [x] Typing status.
- [x] Online/last seen.
- [x] Saved messages data model.
- [x] Media upload for images/video/voice/files.
- [x] WebSocket realtime events.
- [x] 1:1 audio/video call signaling.
- [ ] Backend pagination for long message history.
- [ ] Robust optimistic UI retry queue.
- [ ] Persist pinned/muted/archived chat state on backend.
- [ ] Add integration tests for auth, chats, messages, media and WebSocket flows.
- [ ] Add e2e tests for the main user workflows.

## Phase 2 - Telegram-Parity Core

Goal: move mock Telegram-like surfaces to real server-backed behavior.

- [ ] Phone-number login flow or explicit decision to keep username/password auth.
- [ ] QR login.
- [ ] Two-factor password.
- [ ] Contact list and contact import mock boundary.
- [ ] Chat folders: All, Unread, Personal, Groups, Channels, Bots, Archived.
- [ ] Archive chats.
- [ ] Pinned chats and pinned messages.
- [ ] Mute/unmute per chat with optional mute-until date.
- [ ] Global search across users, chats and messages.
- [ ] In-chat message search with jump-to-message.
- [ ] Forward single and selected messages.
- [ ] Multi-select messages.
- [ ] Clear history and delete-for-me.
- [ ] Link previews with disable-preview option.
- [ ] Message formatting: bold, italic, code, quote, spoiler.
- [ ] Date separators and unread separators.
- [ ] Shared media/files/links gallery.

## Phase 3 - Groups and Channels

Goal: make group/channel workflows real, not only UI states.

- [ ] Group roles: owner, admin, moderator, member.
- [ ] Admin permissions.
- [ ] Member permissions.
- [ ] Invite links and join requests.
- [ ] Ban/kick/temporary ban.
- [ ] Group rules and slow mode.
- [ ] Admin action log.
- [ ] Mentions and replies counters.
- [ ] Topics/threads inside groups.
- [ ] Topic unread counters and pinned topics.
- [ ] Polls and quiz polls.
- [ ] Channel subscribers.
- [ ] Channel admins and permissions.
- [ ] Channel post publishing/editing/deletion.
- [ ] Scheduled and silent posts.
- [ ] Post views and repost counters.
- [ ] Channel discussion groups.
- [ ] Channel stats.

## Phase 4 - Media, Stickers and Rich Messages

Goal: close the gap around expressive messaging.

- [ ] Emoji panel with search, categories and recent emoji.
- [ ] Sticker panel.
- [ ] Sticker packs and favorites.
- [ ] GIF search and recent GIFs.
- [ ] Custom emoji model.
- [ ] Voice player with waveform and speed control.
- [ ] Audio player and mini-player.
- [ ] Media album sending.
- [ ] Upload progress and cancel upload.
- [ ] Download manager.
- [ ] File drag-and-drop.
- [ ] Location/live location UI contract.
- [ ] Contact card messages.

## Phase 5 - Calls, Stories, Bots and Mini Apps

Goal: implement the larger Telegram-like product areas with honest mock boundaries while backend pieces are missing.

- [ ] Group voice chat.
- [ ] Group video chat.
- [ ] Call participants and call history.
- [ ] Screen sharing with real media track support where available.
- [ ] Stories list, viewer and privacy settings.
- [ ] Bot accounts.
- [ ] Bot commands and inline/reply keyboards.
- [ ] Bot permissions in groups.
- [ ] Mini app container, permissions and close/back flow.
- [ ] Mock payments API contract.
- [ ] Premium/stars module as a separate optional subsystem.

## Phase 6 - Security and Production Architecture

Goal: stop treating local MVP infrastructure as production.

- [ ] Threat model.
- [ ] Separate cloud chats and secret chats in product language.
- [ ] Audited E2EE protocol for secret chats.
- [ ] Device verification.
- [ ] Key rotation and key backup/recovery.
- [ ] Suspicious-login alerts.
- [ ] Rate limits beyond auth.
- [ ] Report spam/user/message flows.
- [ ] Admin panel hidden from normal users.
- [ ] Managed PostgreSQL.
- [ ] Redis/cache for presence, typing, sessions and rate limits.
- [ ] Object storage for media.
- [ ] CDN for media delivery.
- [ ] Queue for background jobs.
- [ ] Push notification service.
- [ ] Backups and restore procedure.
- [ ] Observability: structured logs, metrics, health checks and alerts.
- [ ] Docker/deploy setup.

## Definition of Done

A feature is done only when:

- the backend behavior exists if the feature claims to be real;
- mock-only behavior is visibly documented as mock;
- the data model and API contract are updated;
- mobile and desktop layouts are checked;
- lint/build/tests pass;
- security claims are limited to what is actually implemented.
