@echo off
setlocal
set "APP_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%scripts\windows\Start-VincereNinjaManager.ps1" -DatabaseUrl "file://.data/operator-local-readiness" -SkipNinjaTrader -SkipCompanion
endlocal
