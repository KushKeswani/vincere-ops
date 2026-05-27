@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\strategy-toggle-whatif.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\AppData\Local\Programs\VincereOps\scripts\Set-NinjaTraderStrategiesEnabled.ps1" -Enabled true -WhatIf >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
