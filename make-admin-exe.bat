@echo off
setlocal
cd /d "%~dp0"

echo === Building Onda-Admin.exe (Node SEA) ===

if not exist dist-admin mkdir dist-admin

echo [1/4] Bundling launcher...
call npx esbuild scripts/admin-launcher.cjs --bundle --platform=node --outfile=dist-admin/launcher.cjs || goto :fail

echo [2/4] Creating SEA blob...
node --experimental-sea-config scripts/sea-config.json || goto :fail

echo [3/4] Copying node.exe...
node -e "require('fs').copyFileSync(process.execPath, 'Onda-Admin.exe')" || goto :fail

echo [4/4] Injecting blob...
call npx postject Onda-Admin.exe NODE_SEA_BLOB dist-admin/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 || goto :fail

echo.
echo Done: Onda-Admin.exe
echo Double-click to start the server (Node.js required) and open the admin panel.
exit /b 0

:fail
echo Build failed.
exit /b 1
