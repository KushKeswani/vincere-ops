<#
.SYNOPSIS
    Copies the Vincere NinjaTrader Add-On source into your NT8 Custom AddOns folder.
.DESCRIPTION
    Uses your actual Windows "Documents" folder (respects OneDrive redirection).
    Safe to run multiple times (overwrites same file).

.PARAMETER CustomDocumentsRoot
    If NinjaTrader looks elsewhere, pass the folder that contains "NinjaTrader 8",
    e.g. C:\Users\Administrator\Documents or your OneDrive Documents root.
.EXAMPLE
    .\Install-VincereAddon.ps1
.EXAMPLE
    .\Install-VincereAddon.ps1 -CustomDocumentsRoot "D:\Users\Admin\Documents"
#>
param(
    [string]$CustomDocumentsRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$src = Join-Path $repoRoot "nt8-addon\VincereOperatorIpcAddOn.cs"
if (-not (Test-Path $src)) {
    Write-Error "Missing $src — clone vincere-ops and run: .\scripts\Install-VincereAddon.ps1 from the repo (or cd to repo root first)."
}

$documentsRoot = if (-not [string]::IsNullOrWhiteSpace($CustomDocumentsRoot)) {
    $CustomDocumentsRoot.TrimEnd('\')
} else {
    [Environment]::GetFolderPath('MyDocuments')
}

if (-not (Test-Path $documentsRoot)) {
    Write-Error "Documents folder not found: $documentsRoot"
}

$destDir = Join-Path $documentsRoot "NinjaTrader 8\bin\Custom\AddOns\VincereOperator"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir "VincereOperatorIpcAddOn.cs"

Write-Host "Source: $src" -ForegroundColor Gray
Write-Host "USERPROFILE: $($env:USERPROFILE)" -ForegroundColor Gray
Write-Host "Documents root used: $documentsRoot" -ForegroundColor Gray
Write-Host ""

Copy-Item -Path $src -Destination $dest -Force

if (-not (Test-Path $dest)) {
    Write-Error "Copy reported success but file missing at: $dest"
}

$srcLen = (Get-Item $src).Length
$dstLen = (Get-Item $dest).Length
if ($dstLen -lt 1) {
    Write-Error "Destination file is empty: $dest"
}

Write-Host "Copied Add-On ($dstLen bytes) to:" -ForegroundColor Green
Write-Host "  $dest"
Write-Host ""
Write-Host "If NinjaTrader still does not see it, confirm in NT: Tools -> Options -> NinjaScript -> list where Custom is, or search your PC for an existing folder 'NinjaTrader 8\bin\Custom' and pass -CustomDocumentsRoot (parent of NinjaTrader 8)." -ForegroundColor Yellow
Write-Host "Next: NinjaTrader -> NinjaScript Editor -> Compile, then restart NT." -ForegroundColor Yellow
