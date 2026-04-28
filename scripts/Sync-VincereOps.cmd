@echo off
REM One-click sync: pull, patch pipe, install add-on, publish app, update env.
cd /d "%~dp0.."
if not exist "scripts\Sync-VincereOps.ps1" (
  echo ERROR: Missing scripts\Sync-VincereOps.ps1
  pause
  exit /b 1
)

set PIPE_NAME=%1
if "%PIPE_NAME%"=="" set PIPE_NAME=VincereOperator2

set PROP_CONN=%2

echo Running sync with pipe: %PIPE_NAME%
if "%PROP_CONN%"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sync-VincereOps.ps1" -PipeName "%PIPE_NAME%"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sync-VincereOps.ps1" -PipeName "%PIPE_NAME%" -PropConnectionName "%PROP_CONN%"
)
if errorlevel 1 pause

