@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\probe-control-center-strategies-tab.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Probe-ControlCenterStrategiesTab.ps1" -OpenContextMenu >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
