@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

REM Load a persistent mobile API URL. An explicitly set variable wins.
if "%VITE_API_BASE%"=="" if exist ".env.mobile" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env.mobile") do (
    if /i "%%A"=="VITE_API_BASE" set "VITE_API_BASE=%%B"
  )
)

if "%ANDROID_HOME%"=="" if exist "D:\android-sdk\platform-tools" set "ANDROID_HOME=D:\android-sdk"
if "%JAVA_HOME%"=="" if exist "D:\jdk21\jdk-21.0.11+10\bin\java.exe" set "JAVA_HOME=D:\jdk21\jdk-21.0.11+10"

if "%VITE_API_BASE%"=="" (
  echo [X] VITE_API_BASE is not configured.
  echo     Copy .env.mobile.example to .env.mobile and set your HTTPS domain.
  exit /b 1
)

if /i not "%VITE_API_BASE:~0,8%"=="https://" (
  echo [X] VITE_API_BASE must start with https://
  exit /b 1
)

echo [1/4] Building web app for %VITE_API_BASE%...
call npm run build
if errorlevel 1 goto :fail

echo [2/4] Syncing the Android project...
call npx cap sync android
if errorlevel 1 goto :fail

echo [3/4] Building Android...
cd android

if /i "%~1"=="release" (
  call gradlew.bat bundleRelease
  if errorlevel 1 goto :fail
  echo [4/4] AAB: android\app\build\outputs\bundle\release\app-release.aab
) else (
  call gradlew.bat assembleDebug
  if errorlevel 1 goto :fail
  echo [4/4] APK: android\app\build\outputs\apk\debug\app-debug.apk
)

cd ..
exit /b 0

:fail
echo [X] Build failed. Check the output above.
cd /d "%~dp0"
exit /b 1
