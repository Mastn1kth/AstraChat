@echo off
cd /d "%~dp0"
echo Starting AstraChat backend...
node server/index.js
if errorlevel 1 (
    echo.
    echo Server exited with an error.
    pause
)
