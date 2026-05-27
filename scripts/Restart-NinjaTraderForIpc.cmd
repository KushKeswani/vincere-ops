@echo off
taskkill /IM NinjaTrader.exe /F >nul 2>nul
timeout /t 8 /nobreak >nul
start "" "C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe"
