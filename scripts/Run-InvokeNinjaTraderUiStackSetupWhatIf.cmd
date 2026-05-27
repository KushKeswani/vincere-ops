@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\invoke-ui-stack-setup-whatif.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-NinjaTraderUiStackSetup.ps1" -StackJsonPath "C:\Users\Administrator\Desktop\vincere-ops\logs\test-ui-stack-payload.json" -WhatIf >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
