@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\invoke-ui-stack-setup-ogx-whatif.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\Desktop\vincere-ops\scripts\Invoke-NinjaTraderUiStackSetup.ps1" -StackJsonPath "C:\Users\Administrator\Desktop\vincere-ops\logs\test-ui-stack-blueprint-ogx-payload.json" -WhatIf >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
