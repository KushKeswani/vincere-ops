<#
.SYNOPSIS
    Copies the Vincere NinjaTrader Add-On into NT8's Custom\AddOns folder.
.DESCRIPTION
    Finds existing NinjaTrader "Custom" folders under your profile, copies the .cs into each,
    or creates the standard path under Documents if none exist yet.

    If the window closes instantly when you double-click this file, use **Install-VincereAddon.cmd**
    instead, or run from an open PowerShell window (see SETUP_WINDOWS.md).

.PARAMETER CustomDocumentsRoot
    Parent folder that contains the "NinjaTrader 8" directory (optional override).
.PARAMETER NoPause
    Skip "Press Enter" at the end (for automation).
.EXAMPLE
    .\Install-VincereAddon.ps1
.EXAMPLE
    .\Install-VincereAddon.ps1 -CustomDocumentsRoot "C:\Users\Administrator\Documents"
#>
param(
    [string]$CustomDocumentsRoot = "",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

function Get-NinjaTraderCustomDirs {
    param([string]$ForcedRoot)
    $result = New-Object System.Collections.Generic.HashSet[string]

    if (-not [string]::IsNullOrWhiteSpace($ForcedRoot)) {
        $r = $ForcedRoot.TrimEnd('\')
        $c = Join-Path $r "NinjaTrader 8\bin\Custom"
        if (Test-Path $c) {
            [void]$result.Add((Resolve-Path $c).Path)
            return @($result)
        }
        Write-Warning "No folder at: $c - will create default path under forced root."
        [void]$result.Add($c)
        return @($result)
    }

    $docBases = New-Object System.Collections.ArrayList
    foreach ($p in @(
            [Environment]::GetFolderPath('MyDocuments'),
            [Environment]::GetFolderPath('Personal'),
            (Join-Path $env:USERPROFILE 'Documents')
        )) {
        if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path $p)) { [void]$docBases.Add($p) }
    }

    # OneDrive: ...\OneDrive\Documents and ...\OneDrive - *\Documents
    $odParent = Join-Path $env:USERPROFILE 'OneDrive'
    if (Test-Path $odParent) {
        $odDocs = Join-Path $odParent 'Documents'
        if (Test-Path $odDocs) { [void]$docBases.Add($odDocs) }
    }
    Get-ChildItem $env:USERPROFILE -Directory -Filter 'OneDrive*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            $d = Join-Path $_.FullName 'Documents'
            if (Test-Path $d) { [void]$docBases.Add($d) }
        }

    foreach ($base in ($docBases | Select-Object -Unique)) {
        $custom = Join-Path $base 'NinjaTrader 8\bin\Custom'
        if (Test-Path $custom) {
            [void]$result.Add((Resolve-Path $custom).Path)
        }
    }

    # Shallow search: NinjaTrader 8 under profile (Documents / Desktop / etc.)
    if ($result.Count -eq 0) {
        Get-ChildItem $env:USERPROFILE -Directory -Filter 'NinjaTrader 8' -Recurse -Depth 5 -ErrorAction SilentlyContinue |
            ForEach-Object {
                $custom = Join-Path $_.FullName 'bin\Custom'
                if (Test-Path $custom) {
                    [void]$result.Add((Resolve-Path $custom).Path)
                }
            }
    }

    return @($result | Sort-Object -Unique)
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$src = Join-Path $repoRoot "nt8-addon\VincereOperatorIpcAddOn.cs"
if (-not (Test-Path $src)) {
    Write-Host "ERROR: Missing source file:" -ForegroundColor Red
    Write-Host "  $src"
    Write-Host "Clone https://github.com/KushKeswani/vincere-ops and run this script from that repo." -ForegroundColor Yellow
    if (-not $NoPause) { Read-Host "`nPress Enter to exit" }
    exit 1
}

$forcedRootArg = $CustomDocumentsRoot
if ([string]::IsNullOrWhiteSpace($forcedRootArg)) {
    $forcedRootArg = ""
}
$customDirs = Get-NinjaTraderCustomDirs -ForcedRoot $forcedRootArg

# No existing Custom folder: create default under Windows Documents
if ($customDirs.Count -eq 0) {
    $base = [Environment]::GetFolderPath('MyDocuments')
    if ([string]::IsNullOrWhiteSpace($base) -or -not (Test-Path $base)) {
        $base = Join-Path $env:USERPROFILE 'Documents'
    }
    $fallback = Join-Path $base 'NinjaTrader 8\bin\Custom'
    Write-Host "No existing NinjaTrader 8 ...\bin\Custom folder found - creating:" -ForegroundColor Yellow
    Write-Host "  $fallback"
    Write-Host "(This is normal on a fresh NT install before first compile.)" -ForegroundColor DarkGray
    $customDirs = @($fallback)
}

Write-Host "Source: $src"
Write-Host "USERPROFILE: $($env:USERPROFILE)"
Write-Host ""

$copiedTo = New-Object System.Collections.ArrayList
foreach ($customRoot in $customDirs) {
    $destDir = Join-Path $customRoot "AddOns\VincereOperator"
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $dest = Join-Path $destDir "VincereOperatorIpcAddOn.cs"
    Copy-Item -Path $src -Destination $dest -Force
    if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1) {
        Write-Error "Copy failed: $dest"
    }
    [void]$copiedTo.Add($dest)
    Write-Host "Copied ($((Get-Item $dest).Length) bytes) to:" -ForegroundColor Green
    Write-Host "  $dest"
    Write-Host ""
}

Write-Host "Next in NinjaTrader: New -> NinjaScript Editor -> right-click References / compile all, or Compile." -ForegroundColor Cyan
Write-Host "Then restart NinjaTrader and check Output for: pipe server starting (VincereOperator)" -ForegroundColor Cyan
Write-Host ""
Write-Host "If NT still ignores the file: Tools -> Options -> NinjaScript -> note any custom path;" -ForegroundColor Yellow
Write-Host 'Re-run with: -CustomDocumentsRoot "<parent-folder-that-contains-NinjaTrader-8>"' -ForegroundColor Yellow

if (-not $NoPause) {
    Read-Host "`nPress Enter to close"
}
