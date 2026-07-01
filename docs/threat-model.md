# Threat Model

## Overview

AstraChat is a web messenger MVP with a React/Vite frontend, an Express backend,
REST APIs, WebSocket realtime transport, browser push notifications, local
development storage and optional production services for PostgreSQL, Redis and
S3-compatible media storage.

The most important assets are account sessions, password hashes, message/media
contents, local browser private keys, uploaded files, push subscriptions,
presence data and private chat membership. The product is privacy-sensitive even
as an MVP, so overclaiming encryption is itself a security risk.

## Threat Model, Trust Boundaries, and Assumptions

Trusted components:

- Server runtime configured by the operator.
- Database, Redis and object storage when deployed by a trusted operator.
- Browser runtime only after the app has loaded without malicious script
  injection.

Untrusted or attacker-controlled inputs:

- Login/register/profile/search/message/media request bodies.
- Uploaded files and file metadata.
- WebSocket messages.
- Chat titles, usernames, bios and message formatting.
- Push subscription endpoints supplied by browsers.
- User-agent and IP-derived session metadata.

Major trust boundaries:

- Browser to backend over HTTPS/WSS.
- Authenticated user to other users' chats and media.
- Backend to database/Redis/object storage.
- Browser local storage containing private encryption keys.
- Public internet to Web Push endpoints.

Assumptions:

- Production uses HTTPS/WSS and strong deployment secrets.
- `MESSAGE_ENCRYPTION_KEY`, database credentials, Redis credentials and S3
  credentials are operator secrets.
- The current client-side encryption helpers are not a full audited messaging protocol.
- A compromised server can change delivered JavaScript and public keys, so the
  current model does not protect against a malicious server operator.

## Attack Surface, Mitigations, and Attacker Stories

Auth and sessions:

- Attackers can attempt credential stuffing and password guessing. Auth rate
  limits, password hashing, suspicious-login alerts, TOTP and cloud-password
  flows reduce risk, but they do not replace phishing-resistant device
  verification or hardened account recovery.
- Session theft is partially mitigated by `HttpOnly` cookies and server-side
  token hashes. A stolen browser profile can still expose active cookies and
  local encryption keys.

Authorization:

- Chat membership checks must gate messages, media, reactions, calls, folders
  and per-chat settings. Any missing membership check can leak private content.
- Calls and WebSocket events are sensitive because they can route realtime data
  between users.

Cryptography and key management:

- Server at-rest encryption protects database/media snapshots when the app key is
  not also compromised.
- Browser encryption envelopes reduce plaintext exposure on the server, but they
  have no device verification, no ratchet-based secrecy, no key rotation and no
  audited recovery.
- Exported key backups include private key material and must be treated as
  sensitive secrets.

Uploads and media:

- Uploaded files can target parser/compression bugs, storage exhaustion and
  content-type confusion. Size limits, server-side processing and authenticated
  media routes help, but malware scanning and abuse reporting are missing.

Realtime and push:

- WebSocket origin checks and session auth are required because realtime events
  expose presence, typing, calls and message delivery state.
- Push subscriptions are user-scoped, but push payloads must stay low-sensitivity
  because browser/OS notification services are outside the app trust boundary.

Abuse and moderation:

- Spam, harassment and malicious accounts are realistic once registration is
  public. Report/block flows, admin queues and audit logs are not implemented.

Out of scope for the current MVP:

- Protection against malicious browser extensions or compromised user devices.
- Claims against a malicious server delivering modified JavaScript.
- Nation-state-resistant cryptographic guarantees.
- Full anti-spam automation and content moderation.

## Severity Calibration

Critical:

- Authentication bypass that lets an attacker become another user.
- Missing chat/media authorization that exposes private messages or files across
  users.
- Remote code execution on the server.
- Leakage of `MESSAGE_ENCRYPTION_KEY` together with database/media access.

High:

- Stored XSS in messages, profiles or chat titles because it can steal actions
  and local encryption keys from the browser.
- CSRF or origin-bypass paths that mutate account or chat state.
- WebSocket event spoofing that sends call/message/presence events as another
  user.
- Key-substitution flows that silently replace another user's encryption key.

Medium:

- Weak rate limits that allow spam, brute force or resource exhaustion.
- Push notification leakage of sensitive message contents.
- Incomplete session visibility or inability to terminate unknown sessions.
- Upload handling bugs that expose metadata or cause denial of service.

Low:

- UI-only privacy wording mistakes that do not change behavior but can mislead
  users.
- Non-sensitive profile metadata exposure already intended to be public.
- Local development defaults that are blocked by production startup checks.
