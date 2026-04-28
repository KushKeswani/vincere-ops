@echo off
REM Command Prompt launcher for IPC smoke test (window-friendly).
cd /d "%~dp0.."
if not exist "scripts\Test-VincereIpcSmoke.ps1" (
  echo ERROR: Missing scripts\Test-VincereIpcSmoke.ps1
  pause
  exit /b 1
)

set PIPE_NAME=%1
if "%PIPE_NAME%"=="" set PIPE_NAME=VincereOperator

echo Running IPC smoke test for pipe: %PIPE_NAME%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-VincereIpcSmoke.ps1" -PipeName "%PIPE_NAME%" -Attempts 8 -ConnectTimeoutMs 20000 -DelayMs 400
if errorlevel 1 pause

