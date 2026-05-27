@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-VincereOperatorWindowsUiSmoke.ps1" -IncludeLiveActions -IncludeDestructiveActions -BlueprintPath "%~dp0..\Vincere_Blueprint_2026-04-13.xlsx"
