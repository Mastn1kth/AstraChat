# Production Infrastructure

This project no longer has to run production traffic on local PGlite or local media files.

## Runtime Services

- PostgreSQL: set `DATABASE_URL`. In `NODE_ENV=production` the server refuses to start without it.
- Redis/Valkey: set `REDIS_URL`. In production the server refuses to start without it. It is used for auth rate limits, session cache, online presence TTL keys and WebSocket pub/sub between app replicas, including typing events.
- S3-compatible object storage: set `STORAGE_DRIVER=s3` and the `S3_*` variables. AWS S3, Cloudflare R2 and MinIO all work through the same adapter.
- Media CDN: set `MEDIA_CDN_URL` to a CDN that forwards to the app, not to a public bucket. The app signs short-lived ciphertext URLs for client-encrypted media.
- Web Push: set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Browsers require HTTPS outside localhost.
- Native push login codes: set `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_FILE`. Without SMS, phone login in production depends on FCM/APNs push delivery to the freshly installed app.
- WebRTC calls: set `WEBRTC_STUN_URLS` and at least one TURN/TURNS server through `WEBRTC_TURN_URLS` or `WEBRTC_ICE_SERVERS`. In `NODE_ENV=production` the server refuses to start without TURN because STUN-only calls fail for many NAT/firewall pairs. For larger group calls, set `WEBRTC_GROUP_MEDIA_MODE=sfu` or `mcu` plus `WEBRTC_MEDIA_SERVER_URL`; this app signs join URLs for that external media server.
- HTTPS/WSS: terminate TLS at a reverse proxy or load balancer. `deploy/nginx.conf` is a working nginx example for `/` and `/ws`.

## Local Production Stack

Copy the env example and fill secrets:

```bash
cp .env.production.example .env.production
```

If the goal is to avoid paid providers, follow
[Free Production Mode](free-production.md): self-host PostgreSQL, Redis, MinIO
and TURN; use Web Push plus Firebase Cloud Messaging instead of SMS; keep group
calls on mesh unless you self-host an SFU.

Generate `MESSAGE_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Generate VAPID keys for Web Push:

```bash
node -e "import('web-push').then(({default:w})=>console.log(w.generateVAPIDKeys()))"
```

Check the production env before starting containers:

```bash
npm run check:prod
```

The check validates required PostgreSQL, Redis, S3, push, cookie, TURN and
SFU/MCU settings without starting the app. It exits with a non-zero status when
required production values are missing.

Configure Firebase Cloud Messaging for native login-code delivery:

```bash
FCM_SERVICE_ACCOUNT_JSON='{"project_id":"...","client_email":"...","private_key":"..."}'
```

Native app files:

- Android: place Firebase `google-services.json` at `android/app/google-services.json`.
- iOS: place Firebase `GoogleService-Info.plist` at `ios/App/App/GoogleService-Info.plist` and add it to the Xcode app target if Xcode does not pick it up automatically.
- iOS push through FCM also requires an APNs key uploaded in Firebase Console.
- After changing native Firebase files, run `npm run mobile:sync`.

The first phone-login step asks the installed mobile app for notification
permission, gets a native push token and sends the login code through FCM/APNs.
If production cannot deliver that push, the server returns `push_required`
instead of pretending an SMS was sent.

Configure WebRTC ICE:

```bash
WEBRTC_STUN_URLS=stun:stun.example.com:3478
WEBRTC_TURN_URLS=turns:turn.example.com:5349
WEBRTC_TURN_USERNAME=turn-user
WEBRTC_TURN_CREDENTIAL=turn-secret
WEBRTC_GROUP_MEDIA_MODE=sfu
WEBRTC_MEDIA_SERVER_URL=https://sfu.example.com
WEBRTC_MEDIA_SERVER_TOKEN_TTL_SECONDS=300
```

For multiple ICE providers, use `WEBRTC_ICE_SERVERS` as a JSON array. Group
calls use browser mesh WebRTC unless `WEBRTC_GROUP_MEDIA_MODE` is switched to
`sfu` or `mcu`. The external media server must implement the `/join` contract
or adapt the signed token into its own room-join flow.

Start the app with PostgreSQL, Redis and MinIO. Pass the env file to Compose
so variables such as `POSTGRES_PASSWORD` and `S3_SECRET_ACCESS_KEY` are used
for interpolation:

```bash
docker compose --env-file .env.production up --build
```

Start with nginx HTTPS/WSS edge proxy:

```bash
docker compose --env-file .env.production --profile edge up --build
```

For the nginx profile, place certificates at:

- `deploy/certs/fullchain.pem`
- `deploy/certs/privkey.pem`

## Health, Metrics, Logs

- Liveness: `GET /api/live`
- Readiness: `GET /api/health` checks database, storage and Redis.
- Prometheus metrics: `GET /metrics`
- Docker logs use rotation in `docker-compose.yml`.

## Backups

For real production, use provider-native backups:

- PostgreSQL point-in-time recovery and daily snapshots.
- Object storage versioning/lifecycle rules.
- Redis persistence only for recovery convenience; durable app data must stay in PostgreSQL/S3.

For the included local compose stack, Docker volumes hold data. Back them up or replace compose services with managed providers before real users.

Self-hosted compose backup helpers:

```bash
./deploy/backup-postgres.sh
```

```powershell
.\deploy\backup-postgres.ps1
```

Store those backups outside the host that runs the app. A local backup folder on the same disk is only a recovery convenience, not disaster recovery.

## CDN

Uploaded media is stored in S3-compatible object storage. Do not make the bucket
public.

For client-encrypted media, `MEDIA_CDN_URL` enables short-lived signed URLs to
`/api/media/:id/ciphertext`. A CDN can cache that response because it is still
ciphertext and the URL expires. Server-encrypted-only media continues to use the
authenticated `/api/media/:id` route.

## Limits Still Not Solved

This is an infrastructure baseline, not a full production operating model. Before real public launch, still do:

- load testing for WebSocket fanout and large media downloads;
- centralized logs and alerts;
- database migration review/rollback process;
- secrets manager instead of plain env files;
- an actual SFU/MCU service and browser adapter before claiming large group-call capacity;
- security review for auth, uploads, WebRTC signaling and encryption claims.
