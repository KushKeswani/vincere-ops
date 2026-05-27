@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\ninjascript-compile.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Compile-NinjaScriptEditor.ps1" -WaitSeconds 25 >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
