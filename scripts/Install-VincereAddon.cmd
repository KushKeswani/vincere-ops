@echo off
REM Double-click this so the window stays open and you can read paths/errors.
cd /d "%~dp0.."
if not exist "nt8-addon\VincereOperatorIpcAddOn.cs" (
  echo ERROR: Run this from inside the vincere-ops repo clone after git pull.
  echo Current dir: %CD%
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-VincereAddon.ps1"
if errorlevel 1 pause
