@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\probe-nt-strategies-dialog-add.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Probe-NinjaTraderStrategiesDialogAdd.ps1" -StrategyNameContains "CDGN" >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
