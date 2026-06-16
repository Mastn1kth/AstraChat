# AstraChat

AstraChat is a modern, privacy-focused messenger built as a real app — not a landing page. It ships a full-stack chat platform with end-to-end encryption helpers, WebRTC calls, groups, channels, media sharing and a clean purple UI designed to feel native and intuitive from the first second.

The goal: a messenger you actually want to use.

## Current State

This repository already contains a working web messenger MVP:

- React + Vite frontend.
- Express backend with REST API.
- WebSocket realtime transport.
- VAPID Web Push for offline/browser push delivery.
- PGlite/PostgreSQL-compatible local storage.
- Registration, login, logout, sessions and password change.
- User profiles, avatars and account deletion.
- Private chats, groups, channels and saved-message chat model.
- Text messages, replies, editing, deletion, reactions and read status.
- Online presence, last seen and typing status.
- Image, video, voice and file upload.
- Server-side encryption at rest for messages/media.
- Client-side encryption helpers for text/media envelopes. This is not a full audited E2EE or secret-chat protocol.
- Audio/video calls through WebRTC signaling.
- Desktop notifications and incoming-message sound.
- Per-chat mute and push modes with mention-aware notification filtering.

Some features are intentionally still UI-only or mock states. They are tracked in the roadmap instead of being presented as production-ready.

## Documentation

- [Source prompt](docs/source-prompt.md) - original product prompt added to the project.
- [Roadmap](docs/roadmap.md) - staged plan from current MVP to production-grade messenger.
- [Data model](docs/data-model.md) - current durable entities and security boundaries.
- [Security posture](docs/security.md) - honest security claims, current controls and missing flows.
- [Threat model](docs/threat-model.md) - repository-scoped security model for future review.
- [Production infrastructure](docs/production.md) - PostgreSQL, Redis, S3-compatible storage, Docker, health checks, metrics and backup notes.
- [GitHub page copy](docs/github-page.md) - short public repository description.

## Real vs Mock

Actually working now:

- account registration/login with cookie sessions;
- profile and avatar changes;
- server-backed chat loading and creation;
- message send/edit/delete/reaction/read flows;
- media upload/download;
- realtime events over WebSocket;
- 1:1 and small-group WebRTC call signaling with call history, participant
  state, screen sharing and reconnect handling;
- local theme/settings state.

Mock or incomplete:

- phone/SMS/QR login;
- full group roles, permissions, bans and admin logs;
- full channel publishing workflow, stats, discussions and scheduling;
- chat folders/archive persisted on backend;
- stickers, GIF search, custom emoji packs;
- bots, mini apps and payments;
- stories;
- native iOS/Android push through app stores;
- production-scale storage, CDN, Redis and queues;
- audited E2EE/secret-chat protocol;
- device verification, key rotation, hardened recovery, suspicious-login alerts and report/block moderation flows.

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

Production mode requires `MESSAGE_ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`, VAPID Web Push keys, S3-compatible storage settings and TURN/TURNS WebRTC ICE config. Web Push and real WebRTC calls also require HTTPS in real browsers. The repository includes a Dockerfile, `docker-compose.yml`, nginx HTTPS/WSS example, health/readiness endpoints and Prometheus metrics. Real public usage should still use managed PostgreSQL backups, object-storage versioning, centralized logs/alerts, SFU media infrastructure for large group calls and a security review. Do not claim that all chats are end-to-end encrypted until the full audited protocol, device verification, recovery, key rotation and abuse-handling flows are implemented.
