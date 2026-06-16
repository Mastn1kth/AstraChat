@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  Onda — управление сервером
REM
REM  Использование:
REM    server-admin.bat                  — интерактивное меню
REM    server-admin.bat status           — здоровье сервера и БД
REM    server-admin.bat stats            — подробная статистика
REM    server-admin.bat backup           — создать бэкап (БД + медиа)
REM    server-admin.bat backups          — список бэкапов
REM    server-admin.bat restore <имя>    — восстановить бэкап
REM    server-admin.bat prune 5          — оставить 5 свежих бэкапов
REM    server-admin.bat users            — список пользователей
REM    server-admin.bat wall-clear 30    — очистить стену старше 30 дней
REM    server-admin.bat cleanup          — убрать истёкшие сессии
REM    server-admin.bat start            — запустить сервер
REM    server-admin.bat migrate          — применить миграции БД
REM
REM  Автобэкап раз в сутки (Планировщик задач Windows):
REM    schtasks /create /tn OndaBackup /sc daily /st 03:00 ^
REM      /tr "cmd /c cd /d %~dp0 && server-admin.bat backup && server-admin.bat prune 7"
REM ============================================================

cd /d "%~dp0"

if "%~1"=="" goto :menu

if /i "%~1"=="start"   ( call npm run server:start & exit /b )
if /i "%~1"=="migrate" ( call npm run db:migrate & exit /b )
if /i "%~1"=="prune"   ( node server/admin-cli.js prune-backups %2 & exit /b )
node server/admin-cli.js %1 %2
exit /b %errorlevel%

:menu
echo.
echo   ═══ Onda — управление сервером ═══
echo.
echo   1. Статус сервера и БД
echo   2. Подробная статистика
echo   3. Создать бэкап
echo   4. Список бэкапов
echo   5. Восстановить из бэкапа
echo   6. Пользователи
echo   7. Очистить сессии и старую стену
echo   8. Запустить сервер
echo   9. Применить миграции БД
echo   0. Выход
echo.
set /p choice="Выбор: "

if "%choice%"=="1" node server/admin-cli.js status
if "%choice%"=="2" node server/admin-cli.js stats
if "%choice%"=="3" node server/admin-cli.js backup
if "%choice%"=="4" node server/admin-cli.js backups
if "%choice%"=="5" (
  node server/admin-cli.js backups
  set /p bname="Имя бэкапа: "
  node server/admin-cli.js restore !bname!
)
if "%choice%"=="6" node server/admin-cli.js users
if "%choice%"=="7" node server/admin-cli.js cleanup
if "%choice%"=="8" call npm run server:start
if "%choice%"=="9" call npm run db:migrate
if "%choice%"=="0" exit /b 0

echo.
pause
goto :menu
