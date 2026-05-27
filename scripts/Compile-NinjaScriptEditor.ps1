param(
    [int]$WaitSeconds = 25
)

$ErrorActionPreference = "Stop"

$shell = New-Object -ComObject WScript.Shell
$activated = $shell.AppActivate("NinjaScript Editor")
if (-not $activated) {
    throw "Could not activate a window with title containing 'NinjaScript Editor'."
}

Start-Sleep -Milliseconds 500
$shell.SendKeys("{F5}")
Start-Sleep -Seconds $WaitSeconds

Write-Host "activated=$activated"
Write-Host "compileRequested=True"
