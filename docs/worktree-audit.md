# Working Tree Audit

Generated after the free-first push/call/cleanup pass.

## Ready / Verified In Current Pass

- Frontend production build is forced to production React in `vite.config.js`.
- Main chat UI, QR generation and push helpers are code-split/lazy-loaded.
- Story replies open/update the private chat path.
- Production env preflight exists in `scripts/check-production-env.mjs`.
- Native push cleanup now removes saved `fcm:<token>` endpoints on logout/switch
  and cleans Capacitor listener handles.
- WebRTC calls now attempt one ICE restart before failing the call.
- Free production docs exist in `docs/free-production.md`.
- Optional self-host TURN compose profile exists in `docker-compose.yml`.

## Current Pass Files

- `src/utils/push.js`
- `server/validation.js`
- `server/validation.test.js`
- `src/hooks/useWebRTCCall.js`
- `docker-compose.yml`
- `.env.production.example`
- `docs/free-production.md`
- `docs/production.md`
- `scripts/check-production-env.mjs`
- `server/production-env-check.test.js`
- `vite.config.js`
- `src/utils/qrCode.js`
- `src/components/AuthScreen.jsx`
- `src/components/Sidebar.jsx`
- `src/App.jsx`

## Older Uncommitted Product Work Present In The Tree

These files were already part of the broader uncommitted messenger work and
should be reviewed as product changes, not discarded as trash:

- `server/call-media-server.js`
- `server/media-cdn.js`
- `server/config.test.js`
- `server/call-media-server.test.js`
- `server/media-cdn.test.js`
- `src/utils/clientEncryption.js`
- `src/components/LottieAnimation.jsx`
- `public/stickers/wave.json`
- docs and README updates covering API, data model, roadmap, security, mobile
  release and production notes.

## Local / Generated Artifacts

These are local runtime outputs and should stay uncommitted:

- `data/`
- `dist/`
- `e2e-data/`
- `playwright-report/`
- `test-results/`
- `logs/`
- `node_modules/`
- `server-data-v5/`

## Notes

- `src/utils/e2ee.js` is deleted and replaced by `src/utils/clientEncryption.js`.
- There are many modified tracked files. Do not run broad reset/checkout unless
  the target set is explicitly reviewed.
- Before committing, split changes into logical commits: production readiness,
  push lifecycle, WebRTC recovery, story replies, media/CDN/encryption, docs.
