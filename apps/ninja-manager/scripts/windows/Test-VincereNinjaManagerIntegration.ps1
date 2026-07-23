[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'Vincere\NinjaManager\companion.json'),
    [switch]$RequireAddOn
)

$ErrorActionPreference = 'Stop'
$scripts = @(
    (Join-Path $PSScriptRoot 'Prepare-VincereNinjaManagerIntegration.ps1'),
    (Join-Path $PSScriptRoot 'Install-VincereNinjaManagerAddOn.ps1'),
    (Join-Path $PSScriptRoot 'Restore-VincereNinjaManagerAddOn.ps1'),
    (Join-Path $PSScriptRoot 'Start-VincereNinjaManagerCompanion.ps1')
)
foreach ($script in $scripts) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "PowerShell syntax failed for $script`: $($errors.Message -join '; ')" }
}

& (Join-Path $PSScriptRoot 'Prepare-VincereNinjaManagerIntegration.ps1') -DryRun
& (Join-Path $PSScriptRoot 'Install-VincereNinjaManagerAddOn.ps1') -DryRun

if ($RequireAddOn) {
    & (Join-Path $PSScriptRoot 'Start-VincereNinjaManagerCompanion.ps1') -Mode Doctor -ConfigPath $ConfigPath
}
else {
    Write-Host '[Vincere Ninja Manager] Add-On doctor skipped until the supervised NinjaTrader compile step.'
}
Write-Host '[Vincere Ninja Manager] Offline integration validation passed.'
