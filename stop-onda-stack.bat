@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo [1/3] Stopping Onda backend...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server/index.js*' }; foreach($p in $targets){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('    stopped node pid ' + $p.ProcessId) }"

echo [2/3] Stopping Onda frontend...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*vite*' -and $_.CommandLine -like '*--port 5173*' }; foreach($p in $targets){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('    stopped frontend pid ' + $p.ProcessId) }"

echo [3/3] Stopping Cloudflare Tunnel gory-staff-local...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*tunnel run gory-staff-local*' }; foreach($p in $targets){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host ('    stopped cloudflared pid ' + $p.ProcessId) }"

del ".onda-server.pid" 2>nul
del ".onda-frontend.pid" 2>nul
del ".onda-cloudflared.pid" 2>nul

echo.
echo Stopped. The phone app and local web app will not connect until start-onda-stack.bat is run again.
exit /b 0
