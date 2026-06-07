# AstraChat

AstraChat is a Telegram-like messenger prototype built as an actual app first, not as a landing page. The product goal is to keep the familiar messenger structure: chat list, private chats, groups, channels, saved messages, media, reactions, calls, profiles, settings, security boundaries and a backend-ready architecture.

The project must not copy Telegram's name, logo, icons or brand. Telegram is used only as a functional and UX reference.

## Current State

This repository already contains a working web messenger MVP:

- React + Vite frontend.
- Express backend with REST API.
- WebSocket realtime transport.
- PGlite/PostgreSQL-compatible local storage.
- Registration, login, logout, sessions and password change.
- User profiles, avatars and account deletion.
- Private chats, groups, channels and saved-message chat model.
- Text messages, replies, editing, deletion, reactions and read status.
- Online presence, last seen and typing status.
- Image, video, voice and file upload.
- Server-side encryption at rest for messages/media.
- Client-side E2EE helpers for encrypted text/media envelopes.
- Audio/video calls through WebRTC signaling.
- Desktop notifications and incoming-message sound.

Some Telegram-like features are intentionally still UI-only or mock states. They are tracked in the roadmap instead of being presented as production-ready.

## Documentation

- [Source prompt](docs/source-prompt.md) - original product prompt added to the project.
- [Roadmap](docs/roadmap.md) - staged plan from current MVP to production-grade messenger.
- [Data model](docs/data-model.md) - current durable entities and security boundaries.
- [GitHub page copy](docs/github-page.md) - short public repository description.

## Real vs Mock

Actually working now:

- account registration/login with cookie sessions;
- profile and avatar changes;
- server-backed chat loading and creation;
- message send/edit/delete/reaction/read flows;
- media upload/download;
- realtime events over WebSocket;
- 1:1 WebRTC call signaling;
- local theme/settings state.

Mock or incomplete:

- phone/SMS/QR login;
- full group roles, permissions, bans and admin logs;
- full channel publishing workflow, stats, discussions and scheduling;
- chat folders/archive persisted on backend;
- stickers, GIF search, custom emoji packs;
- bots, mini apps and payments;
- stories;
- mobile push notifications;
- production-scale storage, CDN, Redis and queues;
- audited E2EE/secret-chat protocol.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm run server
```

Start the frontend:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Check lint:

```bash
npm run lint
```

## Production Notes

Production must provide `MESSAGE_ENCRYPTION_KEY`, HTTPS/WSS, a managed database, object storage, backups, monitoring and a security review. Do not claim that all chats are end-to-end encrypted until the full audited protocol, device verification, recovery and key rotation are implemented.
