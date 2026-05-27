param(
    [string]$NinjaTime = "08:00",
    [string]$OperatorTime = "08:05"
)

$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "Programs\VincereOps"
$ntScript = Join-Path $installDir "Start-NinjaTraderIfNeeded.ps1"
$opScript = Join-Path $installDir "Start-VincereOperatorIfNeeded.ps1"

if (-not (Test-Path $ntScript)) {
    throw "Missing $ntScript"
}
if (-not (Test-Path $opScript)) {
    throw "Missing $opScript"
}

$principal = New-ScheduledTaskPrincipal -UserId "Administrator" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
    -MultipleInstances IgnoreNew

$ntAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ntScript`""
$opAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$opScript`""

$ntTrigger = New-ScheduledTaskTrigger -Daily -At $NinjaTime
$opTrigger = New-ScheduledTaskTrigger -Daily -At $OperatorTime

Register-ScheduledTask `
    -TaskName "PhoenixDailyStartNinjaTrader" `
    -Action $ntAction `
    -Trigger $ntTrigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Register-ScheduledTask `
    -TaskName "VincereOpsDailyStart" `
    -Action $opAction `
    -Trigger $opTrigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Get-ScheduledTask -TaskName "PhoenixDailyStartNinjaTrader", "VincereOpsDailyStart" |
    Select-Object TaskName, State
