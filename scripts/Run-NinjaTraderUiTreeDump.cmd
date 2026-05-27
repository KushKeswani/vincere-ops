@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\ui-tree-dump-run.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Dump-NinjaTraderUiTree.ps1" -MaxDepth 10 -FlatWindowNamePattern "" -OutPath "C:\Users\Administrator\Desktop\vincere-ops\logs\ninjatrader-ui-tree-deep.txt" >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
