@echo off
set LOG_PATH=C:\Users\Administrator\Desktop\vincere-ops\logs\vincere-ui-tree-run.log
echo [%date% %time%] starting > "%LOG_PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Dump-VincereUiTree.ps1" >> "%LOG_PATH%" 2>&1
echo [%date% %time%] exit %ERRORLEVEL% >> "%LOG_PATH%"
exit /b %ERRORLEVEL%
