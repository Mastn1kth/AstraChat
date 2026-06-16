@echo off
cd /d "%~dp0"

set HOST=127.0.0.1
set PORT=3001
set TRUST_PROXY=1
set ALLOWED_ORIGINS=https://localhost,capacitor://localhost,https://onda.gory-staff.ru
set SESSION_COOKIE_SAME_SITE=none
set SESSION_COOKIE_SECURE=true

echo Starting Onda backend for Cloudflare Tunnel...
node server/index.js
