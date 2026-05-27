param()

$existing = Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue
if ($existing) {
    exit 0
}

Start-Process -FilePath "C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe"
