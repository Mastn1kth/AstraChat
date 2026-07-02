# AstraChat (Onda) — Roadmap

Staged plan from current MVP to a fully production-grade messenger.

## Phase 0 — Project Hygiene

- [x] Add the original product prompt to the repository.
- [x] Replace the default Vite README with project documentation.
- [x] Add a staged roadmap.
- [x] Ignore local database/runtime folders in git.
- [x] Fix current lint errors.
- [x] `.env` template for local development with VAPID keys.
- [x] Add a real git remote and push the current branch.
- [ ] Add screenshots or a short demo GIF to README.

## Phase 1 — Stable MVP

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
- [x] Robust optimistic UI retry queue (exponential backoff 5→15→45s, 3 auto-retries).
- [x] Persist pinned/muted/archived chat state on backend.
- [x] Integration tests for message visibility (delete-for-me, clear-history, delete-for-everyone, pagination).
- [x] Integration tests for auth, media and WebSocket flows.
- [x] E2E tests (Playwright): 18 scenarios — auth, messaging, chats, profile.

## Phase 2 — Core Feature Completeness

Goal: replace remaining mock surfaces with real server-backed behavior.

- [x] Phone-number login flow (push-delivered code + profile creation, backend + AuthScreen).
- [x] QR login (redesigned UI: centered card, pulsing indicator, steps, back button).
- [x] Auth screen redesign: view toggle for password login (replaces phone field, not expands).
- [x] Two-factor password (cloud password — scrypt-hashed, hint, three-step login).
- [x] Saved contact list: backend model, API and UI add/remove flow.
- [x] Contact import: find registered users by phone number (bulk lookup).
- [x] Chat folders: All, Unread, Personal, Groups, Channels, Archived + custom.
- [x] Archive chats.
- [x] Pinned chats. Pinned messages (backend + WS broadcast + UI bar with jump/unpin).
- [x] Mute/unmute per chat with mute-until date. Duration picker: 1h, 8h, 1d, 1w, Forever.
- [x] Global search across users, chats and messages.
- [x] In-chat message search with jump-to-message.
- [x] Forward single and selected messages. Multi-select with bulk forward and bulk delete.
- [x] Multi-select messages (checkbox mode, bulk forward/delete bar).
- [x] Clear history and delete-for-me.
- [x] Link previews with disable-preview toggle in Composer.
- [x] Message formatting: bold, italic, code, quote, spoiler.
- [x] Unread message separator.
- [x] Shared media/files/links gallery (server-backed, paginated).
- [x] Favicon unread badge (canvas-drawn red circle with count).
- [x] Disappearing messages (per-message `disappearsAt`, per-chat auto-delete timer, background cleanup job, live countdown badge).
- [x] Message scheduling (send at specific time, scheduled list panel).
- [x] Profile privacy settings (who sees phone / last seen / avatar — everyone/contacts/nobody).
- [x] Read receipts (per-recipient `message_reads`, ✓/✓✓ checkmarks, persistent unread counts survive reload via `chat_members.last_read_message_id`).
- [x] Message drafts (localStorage-backed per-chat draft save/restore in Composer).
- [x] Round video messages ("video notes" — record via camera + `MediaRecorder`, circular playback, reuses the voice-message upload pipeline).
- [x] Telegram chat history import (parse Telegram JSON export, encrypt and insert as regular messages with `imported_from_name` label).
- [x] Inline message translation (client-side only via MyMemory API — no plaintext sent to the Onda backend; see docs/security.md for the actual encryption model).

## Phase 3 — Groups and Channels

Goal: make group/channel workflows real, not only UI states.

- [x] Group roles: owner, admin, moderator, member.
- [x] Admin permissions.
- [x] Member permissions.
- [x] Invite links and join requests.
- [x] Ban/kick/temporary ban.
- [x] Group rules and slow mode.
- [x] Admin action log.
- [x] Mentions and replies counters.
- [x] Topics/threads inside groups.
- [x] Topic unread counters and pinned topics.
- [x] Polls and quiz polls.
- [x] Channel subscribers.
- [x] Channel admins and permissions.
- [x] Channel post publishing/editing/deletion.
- [x] Scheduled and silent posts.
- [x] Post views and repost counters.
- [x] Channel discussion groups.
- [x] Channel stats.
- [x] Reaction aggregation in channel posts (emoji breakdown by type — already via publicMessagesFromRows).
- [x] Join/leave event messages in group history (system messages: `member_added`/`member_removed`/`auto_delete_changed`, rendered as centered pills).

## Phase 4 — Media, Stickers and Rich Messages

Goal: close the gap around expressive messaging.

- [x] Emoji panel with search, categories and recent emoji.
- [x] Sticker panel.
- [x] Sticker packs and favorites.
- [x] GIF search and recent GIFs (Tenor integration).
- [x] Custom emoji model (packs, inline `:shortcode:` rendering, picker tab).
- [x] Voice player with waveform visualization and playback speed control.
- [x] Audio player and persistent mini-player (survives chat switching).
- [x] Media album sending (grouped upload, grid display).
- [x] Upload progress indicator and cancel upload.
- [x] Download manager (combined upload+download panel with progress).
- [x] File drag-and-drop to chat area (overlay indicator, 100 MB limit, multi-file).
- [x] Location message (coordinates + map link).
- [x] Contact card messages.
- [x] Live waveform during voice recording (realtime amplitude bars via Web Audio API).
- [x] Live location sharing (sends GPS updates every N seconds).
- [x] Chat background / wallpaper customization per chat (picker in ProfilePanel, stored in localStorage).

## Phase 5 — Calls and Stories

Goal: implement real-time group calls and ephemeral stories.

- [x] Group voice chat MVP with mesh WebRTC signaling.
- [x] Group video chat MVP with mesh WebRTC signaling.
- [x] Call participants and call history API.
- [x] Screen sharing with real media track support.
- [x] Stories list, viewer and privacy settings (24h expiry, view tracking).
- [x] SFU/MCU handoff config for external group-call media servers.
- [ ] Browser SFU/MCU adapter for a real provider-specific media SDK.
- [x] Story reactions (6-emoji bar, aggregated counts, toggle).
- [x] Story replies (viewer reply creates/reuses a private chat with the story author).
- [x] Story mentions and highlights.

## Phase 6 — Security and Production Architecture

Goal: stop treating local MVP infrastructure as production.

- [x] Threat model documented.
- [x] Rate limits: message 60/min, upload 30/10min, search 200/min — all per user.
- [x] Rate limiter skip in test mode (`NODE_ENV=test`).
- [x] Backend-enforced block user flow.
- [x] Report spam/user/message flows.
- [x] Admin/moderator report review queue.
- [x] Admin panel requires authentication (cookie session).
- [x] SSRF protection on OG scraper (private-IP block list).
- [x] Control-char sanitization in Live Wall (`\x00–\x1f\x7f`).
- [x] Suspicious-login alerts.
- [x] VAPID Web Push service (server-side push to offline users).
- [x] VAPID keys in `.env` for local development.
- [x] Observability: structured logs, metrics, health check.
- [x] PWA manifest + service worker.
- [x] Docker/deploy setup.
- [ ] Device verification (trust chain beyond QR login).
- [ ] Key rotation and key backup/recovery.
- [x] Queue-backed fanout for high-volume push delivery (Postgres-backed `job_queue` table, `FOR UPDATE SKIP LOCKED` claim, exponential backoff, dead-letter status — see `server/job-queue.js`).
- [ ] Native iOS/Android push through app stores (FCM/APNs production config — server-side FCM v1 client exists in `server/fcm.js`, but no real Firebase project/credentials are wired up yet).
- [x] Managed PostgreSQL with backups and restore procedure (`pg_dump`/`pg_restore` via the admin backup endpoint and `deploy/backup-postgres.*` / `deploy/restore-postgres.*`).
- [x] Redis/cache for presence, typing pub/sub, sessions and rate limits via `REDIS_URL`.
- [x] Object storage (S3-compatible) for encrypted media via `STORAGE_DRIVER=s3`.
- [x] CDN for client-encrypted media via short-lived signed ciphertext URLs.
- [x] Queue for background jobs (notifications, cleanup, stats) — same `job_queue` table as push fanout above; push delivery is the first job type wired in.
- [x] Horizontal scaling (stateless nodes + shared Redis + shared DB) — `docker compose --scale`, nginx upstream with DNS re-resolution, no sticky sessions needed since WS/presence/sessions/rate limits are all Redis-backed. PGlite must never run in more than one replica (single-writer); documented in `docs/production.md`.

## Phase 7 — Future Product Extensions

Goal: user-facing messenger features that extend the product without turning it into a bot, mini-app or payments platform.

- [x] Username-based public discovery (`/u/:username` profile links + @username search).
- [x] Emoji status (custom emoji/text status with quick presets).
- [x] Animated stickers (Lottie JSON render for sticker messages and picker; TGS import pipeline still separate).
- [x] Voice-to-text transcription for voice messages (real Whisper (`Xenova/whisper-tiny`, multilingual) inference via `@huggingface/transformers` running fully client-side in a Web Worker over WASM — no server round-trip, no account/API key, model weights cached by the browser after first download; consistent with the app's E2E-encryption model since decrypted audio never leaves the device. Supported anywhere with Worker + WebAssembly (specifically WASM SIMD, see caveat below) + Web Audio API, i.e. all modern evergreen browsers, not just Chrome/Edge/Android as the earlier SpeechRecognition-over-speaker approach required). **Mobile shell caveat (Capacitor):** the shipped onnxruntime-web WASM binary is SIMD-only with no fallback build; Android System WebView has had WASM SIMD since Chromium 91 (fine for effectively all real devices regardless of `minSdkVersion`), but WKWebView only gained it in iOS/Safari 16.4 — and this project's iOS deployment target is 15.0, so real iOS 15.0–16.3 users running the Capacitor app would hit a WASM compile failure. `isSpeechTranscriptionSupported()` (`src/utils/speechTranscription.js`) now feature-detects WASM SIMD via `WebAssembly.validate()` and hides the Transcribe button on engines that lack it, rather than showing a button that fails. Not verified on a physical iOS device/simulator or Android emulator — see `docs/mobile-release.md` for the full analysis and its limits.
- [x] Message translation (inline, per-message — see Phase 2).
- [x] Cross-device quick-share — explicit "send to my devices" action delivered via the existing Saved Messages path (deliberately not passive/background clipboard sync, which would be a privacy risk).

## Explicitly Out of Scope

- Bots, bot accounts, Bot API, inline bots, bot keyboards and bot payment flows.
- Mini apps, WebView apps, JS bridges and mini-app permission flows.
- Payments, Stars, paid subscriptions, paid media, gifts, checkout flows and Premium monetization.

---

## Definition of Done

A feature is ✅ only when:

- the backend behavior exists if the feature claims to be real;
- mock-only behavior is visibly documented as mock;
- the data model and API contract are updated;
- mobile and desktop layouts are checked;
- lint/build/tests pass;
- security claims are limited to what is actually implemented.
