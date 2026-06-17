# AstraChat Roadmap

Staged plan from current MVP to a fully production-grade messenger.

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
- [x] Backend pagination for long message history (cursor-based, `before` + `limit`, `hasMore` flag).
- [x] Robust optimistic UI retry queue (exponential backoff 5→15→45s, 3 auto-retries; triggered on network online event).
- [x] Persist pinned/muted/archived chat state on backend.
- [x] Integration tests for message visibility (delete-for-me, clear-history, delete-for-everyone, pagination).
- [x] Integration tests for auth, media and WebSocket flows.
- [ ] Add e2e tests for the main user workflows.

## Phase 2 - Core Feature Completeness

Goal: replace remaining mock surfaces with real server-backed behavior.

- [x] Phone-number login flow (SMS code + profile creation, backend + AuthScreen).
- [x] QR login.
- [x] Two-factor password (cloud password — scrypt-hashed, hint, three-step login, settings in Sidebar).
- [x] Saved contact list: backend model, API and UI add/remove flow.
- [x] Contact import: find registered users by phone number (bulk lookup, up to 100 numbers).
- [x] Chat folders: All, Unread, Personal, Groups, Channels, Archived. Backend + UI implemented with custom folder support.
- [x] Archive chats.
- [x] Pinned chats. Pinned messages (backend + WS broadcast + UI bar with jump/unpin).
- [x] Mute/unmute per chat with mute-until date. Duration picker: 1h, 8h, 1d, 1w, Forever.
- [x] Global search across users, chats and messages. Users/chats are server-backed; message search is limited by encrypted payloads unless `searchText` is provided.
- [x] In-chat message search with jump-to-message. Server-backed search is intentionally limited by encrypted payloads and explicit `searchText`; jump-to-message loads visible history context around the target instead of requiring the message to be already loaded.
- [x] Forward single and selected messages. Multi-select with bulk forward and bulk delete implemented.
- [x] Multi-select messages (checkbox mode, bulk forward/delete bar).
- [x] Clear history and delete-for-me.
- [x] Link previews with disable-preview toggle in Composer.
- [x] Message formatting: bold, italic, code, quote, spoiler (inline parser + format toolbar in Composer).
- [x] Unread message separator (shows "New messages" divider when reopening a chat with unread).
- [x] Shared media/files/links gallery (server-backed, paginated, in profile panel).

## Phase 3 - Groups and Channels

Goal: make group/channel workflows real, not only UI states.

- [x] Group roles: owner, admin, moderator, member.
- [x] Admin permissions.
- [x] Member permissions.
- [x] Invite links and join requests.
- [x] Ban/kick/temporary ban.
- [x] Group rules and slow mode.
- [x] Admin action log.
- [x] Mentions and replies counters (@ mention badge on chat items, topicUnreads tracking).
- [x] Topics/threads inside groups.
- [x] Topic unread counters (badge in TopicsPanel) and pinned topics.
- [x] Polls and quiz polls.
- [x] Channel subscribers.
- [x] Channel admins and permissions.
- [x] Channel post publishing/editing/deletion.
- [x] Scheduled and silent posts.
- [x] Post views and repost counters.
- [x] Channel discussion groups (linked group API, Discussion button in header, admin panel in ProfilePanel).
- [x] Channel stats.

## Phase 4 - Media, Stickers and Rich Messages

Goal: close the gap around expressive messaging.

- [x] Emoji panel with search, categories and recent emoji.
- [x] Sticker panel.
- [x] Sticker packs and favorites (emoji-based; server-backed install/uninstall + localStorage recent + favorites).
- [x] GIF search and recent GIFs (Tenor integration).
- [x] Custom emoji model (packs + items tables, install/uninstall API, inline `:shortcode:` rendering in messages, picker tab in composer).
- [x] Voice player with waveform visualization and playback speed control.
- [x] Audio player and persistent mini-player (survives chat switching).
- [x] Media album sending (grouped upload with shared albumId, grid display in bubbles).
- [x] Upload progress indicator and cancel upload (XHR-based, AbortController).
- [x] Download manager (combined upload+download panel with progress).
- [x] File drag-and-drop to chat area (overlay indicator, 100 MB limit, multi-file).
- [x] Location message (coordinates + map link).
- [x] Contact card messages.

## Phase 5 - Calls and Stories

Goal: implement real-time group calls and ephemeral stories.

- [x] Group voice chat MVP with mesh WebRTC signaling.
- [x] Group video chat MVP with mesh WebRTC signaling.
- [x] Call participants and call history API.
- [x] Screen sharing with real media track support where available.
- [ ] SFU/MCU media server for large production group calls.
- [x] Stories list, viewer and privacy settings (text stories, 24h expiry, view tracking, delete own, StoriesBar rings + StoryViewer overlay).

## Phase 6 - Security and Production Architecture

Goal: stop treating local MVP infrastructure as production.

- [x] Threat model documented for the current repository.
- [x] Separate current cloud/MVP chats and future secret chats in documentation.
- [ ] Audited E2EE protocol for secret chats.
- [ ] Device verification.
- [ ] Key rotation and key backup/recovery. Basic key-change warnings exist.
- [x] Suspicious-login alerts.
- [x] Rate limits beyond auth (message 60/min, upload 30/10min, search/pagination 200/min, all per user).
- [x] Backend-enforced block user flow.
- [x] Report spam/user/message flows.
- [x] Admin/moderator report review queue (PATCH endpoint + review UI in admin-panel.html with status filter).
- [ ] Admin panel hidden from normal users.
- [ ] Managed PostgreSQL.
- [ ] Redis/cache for presence, typing, sessions and rate limits.
- [ ] Object storage for media.
- [ ] CDN for media delivery.
- [ ] Queue for background jobs.
- [x] VAPID Web Push service for offline browser users.
- [ ] Queue-backed fanout for high-volume push delivery.
- [ ] Native iOS/Android push service.
- [ ] Backups and restore procedure.
- [ ] Observability: structured logs, metrics, health checks and alerts.
- [x] PWA manifest + service worker (offline caching, installable, push handling).
- [x] VAPID push notification service (server-side push to offline users).
- [x] Docker/deploy setup.

## Definition of Done

A feature is done only when:

- the backend behavior exists if the feature claims to be real;
- mock-only behavior is visibly documented as mock;
- the data model and API contract are updated;
- mobile and desktop layouts are checked;
- lint/build/tests pass;
- security claims are limited to what is actually implemented.
