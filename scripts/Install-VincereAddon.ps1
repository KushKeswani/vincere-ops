<#
.SYNOPSIS
    Copies the Vincere NinjaTrader Add-On source into your NT8 Custom AddOns folder.
.DESCRIPTION
    Run from the repository root on Windows. Safe to run multiple times (overwrites same file).
#>
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$src = Join-Path $repoRoot "nt8-addon\VincereOperatorIpcAddOn.cs"
if (-not (Test-Path $src)) {
    Write-Error "Missing $src — run this script from the vincere-ops repo."
}

$destDir = Join-Path $env:USERPROFILE "Documents\NinjaTrader 8\bin\Custom\AddOns\VincereOperator"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir "VincereOperatorIpcAddOn.cs"
Copy-Item -Path $src -Destination $dest -Force

Write-Host "Copied Add-On to:" -ForegroundColor Green
Write-Host "  $dest"
Write-Host ""
Write-Host "Next: Open NinjaTrader -> NinjaScript Editor -> Compile (fix errors if any), then restart NT." -ForegroundColor Yellow
