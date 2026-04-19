start "ChatMock" cmd /k "cd /d ""%~dp0chatmock"" && python chatmock.py serve --port 8765 --reasoning-effort low --reasoning-summary none"
start "Quartz" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-quartz.ps1"
start "Dashboard" cmd /k "cd /d ""%~dp0dashboard"" && npm run dev"
