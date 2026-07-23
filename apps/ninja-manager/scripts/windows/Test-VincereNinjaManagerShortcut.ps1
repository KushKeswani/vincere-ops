[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Start-VincereNinjaManager.ps1'
$installer = Join-Path $PSScriptRoot 'Install-VincereNinjaManagerShortcut.ps1'

foreach ($scriptPath in @($launcher, $installer)) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        throw "PowerShell syntax validation failed for $scriptPath`: $($errors.Message -join '; ')"
    }
}

$testShortcut = Join-Path $env:TEMP ("Vincere-Ninja-Manager-{0}.lnk" -f [guid]::NewGuid())
& $installer -ShortcutPath $testShortcut -DryRun
if (Test-Path -LiteralPath $testShortcut) {
    throw 'The shortcut installer created a file during dry-run validation.'
}

$before = @(Get-Process -Name 'NinjaTrader' -ErrorAction SilentlyContinue | Select-Object Id, StartTime)
& $launcher -Port 39991 -DryRun
$after = @(Get-Process -Name 'NinjaTrader' -ErrorAction SilentlyContinue | Select-Object Id, StartTime)

if (Compare-Object $before $after -Property Id, StartTime) {
    throw 'NinjaTrader process state changed during dry-run validation.'
}

Write-Host '[Vincere Ninja Manager] Shortcut and launcher dry-run validation passed.'
