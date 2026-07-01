# Free Production Mode

This project can run without paid messaging infrastructure if you accept the
limits below.

## Free/Low-Cost Stack

- App server: self-hosted Docker host.
- Database: included PostgreSQL container.
- Realtime/session fanout: included Redis container.
- Media storage: included MinIO container.
- Browser push: Web Push with self-generated VAPID keys.
- Native push/login codes: Firebase Cloud Messaging. FCM itself is free for
  this use case, but iOS still needs APNs configured in the Apple/Firebase
  console.
- Calls: WebRTC mesh plus a self-hosted TURN server through the `turn` compose
  profile.
- Group calls: keep `WEBRTC_GROUP_MEDIA_MODE=mesh` unless you self-host an SFU.

## What Is Not Free

- SMS login codes. Do not use SMS if the requirement is zero paid providers.
- Managed PostgreSQL/Redis/S3/CDN if you choose cloud providers instead of the
  included containers.
- A hosted SFU/MCU provider for large group calls.
- Apple Developer Program may be required for real App Store distribution and
  production iOS push workflows.

## Free TURN

Set these values in `.env.production`:

```env
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302
WEBRTC_TURN_URLS=turn:YOUR_PUBLIC_IP:3478
WEBRTC_TURN_USERNAME=onda-turn
WEBRTC_TURN_CREDENTIAL=replace-with-long-random-password

TURN_REALM=onda.local
TURN_USERNAME=onda-turn
TURN_PASSWORD=replace-with-long-random-password
TURN_EXTERNAL_IP=YOUR_PUBLIC_IP
```

Start with:

```bash
docker compose --env-file .env.production --profile turn up --build
```

Open TCP/UDP `3478` and UDP `49160-49200` on the host firewall.

## Free Push

Generate VAPID keys for browser push:

```bash
node -e "import('web-push').then(({default:w})=>console.log(w.generateVAPIDKeys()))"
```

For Android/iOS login-code push, create a Firebase project, add Android and iOS
apps, place the Firebase config files in the native projects, and set
`FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_FILE`.

There is no SMS fallback in free mode. If FCM/APNs is not configured, production
phone login returns `push_required` instead of pretending a paid SMS was sent.

## Limits

- Mesh group calls are practical only for small groups.
- TURN relays media through your server, so bandwidth is still your cost.
- MinIO/PostgreSQL/Redis backups are your responsibility.
- This mode can be public, but it is not the same operational model as managed
  production infrastructure.
