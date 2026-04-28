<#
.SYNOPSIS
    Builds Vincere Ops, publishes Release, and merges %LocalAppData%\Vincere.Operator\.env
.PARAMETER PublishDir
    Output folder for published files (default: %LOCALAPPDATA%\Programs\VincereOps).
.PARAMETER PropConnectionName
    Exact NinjaTrader Control Center connection display name — written to PROP_CONNECTION_NAME.
.PARAMETER DryRun
    When $false (default), sets DRY_RUN=false so the app uses real IPC. Use $true only for testing without NT pipe.
#>
param(
    [string]$PublishDir = (Join-Path $env:LOCALAPPDATA "Programs\VincereOps"),
    [string]$PropConnectionName = "",
    [bool]$DryRun = $false
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "Checking dotnet SDK..."
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Error "dotnet not found. Install .NET SDK 10 from https://dotnet.microsoft.com/download/dotnet/10.0 then re-open PowerShell."
}

dotnet --version

Write-Host "`nBuilding solution..."
dotnet build -c Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`nPublishing Operator to $PublishDir ..."
New-Item -ItemType Directory -Force -Path $PublishDir | Out-Null
dotnet publish "src\Vincere.Operator\Vincere.Operator.csproj" `
    -c Release `
    -r win-x64 `
    --self-contained false `
    -o $PublishDir

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$envExample = Join-Path $repoRoot ".env.example"
$dataDir = Join-Path $env:LOCALAPPDATA "Vincere.Operator"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$envDest = Join-Path $dataDir ".env"

if (-not (Test-Path $envDest)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envDest
        Write-Host "Created $envDest from .env.example" -ForegroundColor Yellow
    } else {
        New-Item -ItemType File -Path $envDest -Force | Out-Null
    }
}

# Merge keys into .env (line-based replace or append)
function Merge-EnvKey {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )
    $lines = @()
    if (Test-Path $Path) {
        $lines = @(Get-Content $Path -ErrorAction Stop)
    }
    $pattern = "^\s*" + [regex]::Escape($Key) + "\s*="
    $found = $false
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            [void]$out.Add("$Key=$Value")
            $found = $true
        } else {
            [void]$out.Add($line)
        }
    }
    if (-not $found) {
        [void]$out.Add("$Key=$Value")
    }
    $out | Set-Content -Path $Path -Encoding utf8
}

$dryRunStr = if ($DryRun) { "true" } else { "false" }
Merge-EnvKey -Path $envDest -Key "DRY_RUN" -Value $dryRunStr
Write-Host "Set DRY_RUN=$dryRunStr in $envDest" -ForegroundColor Cyan

if (-not [string]::IsNullOrWhiteSpace($PropConnectionName)) {
    Merge-EnvKey -Path $envDest -Key "PROP_CONNECTION_NAME" -Value $PropConnectionName.Trim()
    Write-Host "Set PROP_CONNECTION_NAME=$($PropConnectionName.Trim()) in $envDest" -ForegroundColor Cyan
} else {
    Write-Host "PROP_CONNECTION_NAME unchanged (pass -PropConnectionName 'Your NT connection name' to set it)." -ForegroundColor Yellow
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  Run:  `"$PublishDir\Vincere.Operator.exe`""
Write-Host "  Then install NT Add-On:  .\scripts\Install-VincereAddon.ps1"
