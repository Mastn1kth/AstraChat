@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
  echo [0/4] Installing dependencies...
  call npm ci
  if errorlevel 1 (
    echo [X] Dependency install failed.
    exit /b 1
  )
)

if not exist "logs" mkdir "logs"

set HOST=127.0.0.1
set PORT=3001
set TRUST_PROXY=1
set ALLOWED_ORIGINS=https://localhost,capacitor://localhost,https://onda.gory-staff.ru
set SESSION_COOKIE_SAME_SITE=none
set SESSION_COOKIE_SECURE=true

echo [1/4] Checking local Onda server...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server/index.js*' -and $_.ExecutablePath -like '*node.exe' }; if ($p) { $p.ProcessId | Set-Content '.onda-server.pid'; exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo     Starting Onda backend on http://127.0.0.1:3001
  start "Onda backend" /min cmd /c "cd /d "%~dp0" && set HOST=127.0.0.1&& set PORT=3001&& set TRUST_PROXY=1&& set ALLOWED_ORIGINS=https://localhost,capacitor://localhost,https://onda.gory-staff.ru&& set SESSION_COOKIE_SAME_SITE=none&& set SESSION_COOKIE_SECURE=true&& node server/index.js 1>>logs\onda-server.log 2>>&1"
) else (
  echo     Already running.
)

echo [2/4] Waiting for backend...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest 'http://127.0.0.1:3001/api/live' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(!$ok){ exit 1 }"
if errorlevel 1 (
  echo [X] Onda backend did not start. See logs\onda-server.log
  exit /b 1
)

echo [3/4] Checking Cloudflare Tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*tunnel run gory-staff-local*' }; if ($p) { $p.ProcessId | Set-Content '.onda-cloudflared.pid'; exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo     Starting Cloudflare Tunnel gory-staff-local
  start "Onda Cloudflare Tunnel" /min cmd /c "cloudflared tunnel run gory-staff-local 1>>"%~dp0logs\cloudflared.log" 2>>&1"
) else (
  echo     Already running.
)

echo [4/4] Checking public domain...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest 'https://onda.gory-staff.ru/api/live' -UseBasicParsing -TimeoutSec 5; if($r.Content -match '\"ok\"\s*:\s*true'){$ok=$true; break} } catch {}; Start-Sleep -Seconds 2 }; if($ok){ Write-Host '    Public API works: https://onda.gory-staff.ru/api/live'; exit 0 } else { Write-Host '    Public API is not reachable yet. Tunnel may need more time or Cloudflare may be unstable.'; exit 2 }"
if errorlevel 2 (
  echo [!] Local server is running, but public tunnel check failed.
  echo     Try again in a minute or check logs\cloudflared.log
)

echo.
echo Done. Keep this computer powered on for the phone messenger to work.
echo API: https://onda.gory-staff.ru
exit /b 0
