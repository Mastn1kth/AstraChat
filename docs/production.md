# Production Infrastructure

This project no longer has to run production traffic on local PGlite or local media files.

## Runtime Services

- PostgreSQL: set `DATABASE_URL`. In `NODE_ENV=production` the server refuses to start without it.
- Redis/Valkey: set `REDIS_URL`. It is used for auth rate limits, online presence and WebSocket pub/sub between app replicas.
- S3-compatible object storage: set `STORAGE_DRIVER=s3` and the `S3_*` variables. AWS S3, Cloudflare R2 and MinIO all work through the same adapter.
- Web Push: set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Browsers require HTTPS outside localhost.
- Native push login codes: set `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_FILE`. Without SMS, phone login in production depends on FCM/APNs push delivery to the freshly installed app.
- WebRTC calls: set `WEBRTC_STUN_URLS` and at least one TURN/TURNS server through `WEBRTC_TURN_URLS` or `WEBRTC_ICE_SERVERS`. In `NODE_ENV=production` the server refuses to start without TURN because STUN-only calls fail for many NAT/firewall pairs.
- HTTPS/WSS: terminate TLS at a reverse proxy or load balancer. `deploy/nginx.conf` is a working nginx example for `/` and `/ws`.

## Local Production Stack

Copy the env example and fill secrets:

```bash
cp .env.production.example .env.production
```

Generate `MESSAGE_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Generate VAPID keys for Web Push:

```bash
node -e "import('web-push').then(({default:w})=>console.log(w.generateVAPIDKeys()))"
```

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
```

For multiple providers, use `WEBRTC_ICE_SERVERS` as a JSON array. Group calls
currently use browser mesh WebRTC, so keep groups small until an SFU is added.

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

Media is still served through authenticated API routes because files are encrypted and access-controlled. A CDN can sit in front of the app for static assets and API caching rules, but private media should not be made public at the bucket level.

## Limits Still Not Solved

This is an infrastructure baseline, not a full production operating model. Before real public launch, still do:

- load testing for WebSocket fanout and large media downloads;
- centralized logs and alerts;
- database migration review/rollback process;
- secrets manager instead of plain env files;
- SFU/MCU media infrastructure before large group calls;
- security review for auth, uploads, WebRTC signaling and E2EE claims.
