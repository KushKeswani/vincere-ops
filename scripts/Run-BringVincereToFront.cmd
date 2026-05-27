@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Bring-VincereToFront.ps1"
exit /b %ERRORLEVEL%
