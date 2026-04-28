<#
.SYNOPSIS
    git pull in the repo root, then optionally run Setup-VincereOps.ps1 with env defaults.
.PARAMETER PropConnectionName
    Passed through to Setup-VincereOps.ps1 (exact NT connection name).
.PARAMETER SkipSetup
    Only git pull; do not build/publish.
.PARAMETER DryRun
    $false = real IPC (default). $true = DRY_RUN=true for testing without pipe.
.EXAMPLE
    .\Pull-VincereOps.ps1 -PropConnectionName "My Prop Firm"
#>
param(
    [string]$PropConnectionName = "",
    [switch]$SkipSetup,
    [bool]$DryRun = $false
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
    Write-Error "No .git folder — clone first: git clone https://github.com/KushKeswani/vincere-ops.git"
}

Write-Host "git pull (repo: $repoRoot)..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Error "git pull failed."
}

if ($SkipSetup) {
    Write-Host "SkipSetup: not running Setup-VincereOps.ps1" -ForegroundColor Yellow
    exit 0
}

$setup = Join-Path $PSScriptRoot "Setup-VincereOps.ps1"
& $setup -PublishDir (Join-Path $env:LOCALAPPDATA "Programs\VincereOps") -PropConnectionName $PropConnectionName -DryRun $DryRun
