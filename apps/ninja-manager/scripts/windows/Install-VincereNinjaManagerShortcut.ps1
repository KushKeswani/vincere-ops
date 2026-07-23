[CmdletBinding()]
param(
    [string]$ShortcutPath = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$launcherPath = (Resolve-Path (Join-Path $PSScriptRoot 'Start-VincereNinjaManager.ps1')).Path
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not $ShortcutPath) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $ShortcutPath = Join-Path $desktop 'Vincere Ninja Manager.lnk'
}

$shortcutDirectory = Split-Path -Parent $ShortcutPath
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$launcherPath`""
$ninjaTraderIcon = Join-Path $env:ProgramFiles 'NinjaTrader 8\bin\NinjaTrader.exe'
$iconLocation = if (Test-Path -LiteralPath $ninjaTraderIcon) { "$ninjaTraderIcon,0" } else { "$powerShellPath,0" }

$plan = [pscustomobject]@{
    ShortcutPath = $ShortcutPath
    TargetPath = $powerShellPath
    Arguments = $arguments
    WorkingDirectory = $appRoot
    IconLocation = $iconLocation
}

if ($DryRun) {
    Write-Host '[Vincere Ninja Manager] DRY RUN: shortcut would be created with these settings:'
    $plan | Format-List
    return
}

New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $appRoot
$shortcut.Description = 'Start Vincere Ninja Manager and open NinjaTrader'
$shortcut.IconLocation = $iconLocation
$shortcut.Save()

Write-Host "[Vincere Ninja Manager] Desktop shortcut created: $ShortcutPath"
