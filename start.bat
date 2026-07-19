@echo off
start "ChatMock" cmd /k "cd /d ""%~dp0chatmock"" && python chatmock.py serve --port 8765 --reasoning-effort low --reasoning-summary detailed --reasoning-compat legacy"
start "Scriberr" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-scriberr.ps1"
start "Quartz" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-quartz.ps1"
start "OpenHarness" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-openharness.ps1"

echo Waiting for ChatMock on http://127.0.0.1:8765/health ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(90); do { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo ChatMock did not become healthy within 90 seconds. Check the ChatMock window above, then run start.bat again.
  pause
  exit /b 1
)

echo ChatMock is healthy. Starting Dashboard ...
start "Dashboard" cmd /k "cd /d ""%~dp0dashboard"" && npm run dev"
