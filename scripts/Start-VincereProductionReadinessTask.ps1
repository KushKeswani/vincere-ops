<#
.SYNOPSIS
    Starts the production-readiness QA harness in the active Windows desktop.

.DESCRIPTION
    UI Automation and screenshots need an unlocked interactive desktop. This
    helper creates and runs a one-shot Task Scheduler job with /IT so the main
    harness executes in the logged-in RDP session instead of the SSH session.

    By default this runs the safe, non-destructive checks only.
#>
param(
    [string]$TaskName = "VincereProdReadinessSafe",
    [string]$HarnessPath = "$PSScriptRoot\Test-VincereProductionReadiness.ps1",
    [string]$AppPath = "$env:LOCALAPPDATA\Programs\VincereOps\Vincere.Operator.exe",
    [string]$LauncherPath = "$env:ProgramData\VincereProdReadinessTask.ps1",
    [string]$BlueprintPath = "",
    [switch]$IncludeManagerStartStop,
    [switch]$IncludeNinjaTraderLaunchShutdown,
    [switch]$IncludeLiveConnectionActions,
    [switch]$IncludeLiveEnableDisable,
    [switch]$IncludeBlueprintImport,
    [switch]$IncludeLiveAddAll
)

$ErrorActionPreference = "Stop"

function Quote-TaskArg([string]$Value) {
    '"' + ($Value -replace '"', '\"') + '"'
}

function Quote-PowerShellString([string]$Value) {
    "'" + ($Value -replace "'", "''") + "'"
}

if (-not (Test-Path $HarnessPath)) {
    throw "Harness not found: $HarnessPath"
}

$argsList = New-Object 'System.Collections.Generic.List[string]'
$argsList.Add("-AppPath") | Out-Null
$argsList.Add((Quote-PowerShellString $AppPath)) | Out-Null
if (-not [string]::IsNullOrWhiteSpace($BlueprintPath)) {
    $argsList.Add("-BlueprintPath") | Out-Null
    $argsList.Add((Quote-PowerShellString $BlueprintPath)) | Out-Null
}
if ($IncludeManagerStartStop) { $argsList.Add("-IncludeManagerStartStop") | Out-Null }
if ($IncludeNinjaTraderLaunchShutdown) { $argsList.Add("-IncludeNinjaTraderLaunchShutdown") | Out-Null }
if ($IncludeLiveConnectionActions) { $argsList.Add("-IncludeLiveConnectionActions") | Out-Null }
if ($IncludeLiveEnableDisable) { $argsList.Add("-IncludeLiveEnableDisable") | Out-Null }
if ($IncludeBlueprintImport) { $argsList.Add("-IncludeBlueprintImport") | Out-Null }
if ($IncludeLiveAddAll) { $argsList.Add("-IncludeLiveAddAll") | Out-Null }

$launcher = @(
    '$ErrorActionPreference = "Stop"',
    "& $(Quote-PowerShellString $HarnessPath) $($argsList -join ' ')"
)
Set-Content -Path $LauncherPath -Value $launcher -Encoding UTF8

$taskRun = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $(Quote-TaskArg $LauncherPath)"

cmd.exe /c "schtasks.exe /Delete /TN `"$TaskName`" /F >nul 2>nul" | Out-Null
$createArgs = @(
    "/Create",
    "/TN", $TaskName,
    "/SC", "ONCE",
    "/ST", "23:59",
    "/RL", "HIGHEST",
    "/RU", $env:USERNAME,
    "/IT",
    "/TR", $taskRun,
    "/F"
)
& schtasks.exe @createArgs | Out-Host
& schtasks.exe /Run /TN $TaskName | Out-Host

Write-Host "Started $TaskName in the active desktop session."
Write-Host "Harness: $HarnessPath"
Write-Host "Launcher: $LauncherPath"
