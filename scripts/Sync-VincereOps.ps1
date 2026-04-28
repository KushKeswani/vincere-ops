<#
.SYNOPSIS
    One-command sync for VPS: pull latest, align IPC pipe config, install NT add-on, publish app, and patch .env.
.DESCRIPTION
    Use this when you want "pull and run one script" behavior after repo updates.
    This script:
      1) git pull
      2) updates nt8-addon/VincereOperatorIpcAddOn.cs PipeName constant
      3) installs add-on into NinjaTrader Custom AddOns
      4) runs Setup-VincereOps.ps1 (build + publish)
      5) writes IPC keys into %LocalAppData%\Vincere.Operator\.env
    You still need to Compile in NinjaScript Editor and restart NinjaTrader.

.PARAMETER PropConnectionName
    Exact NinjaTrader connection display name (optional but recommended).
.PARAMETER PipeName
    Shared named pipe for app and add-on. Default VincereOperator2.
.PARAMETER ConnectTimeoutMs
    Per-attempt connect timeout for app -> add-on IPC.
.PARAMETER RetryAttempts
    Number of IPC attempts.
.PARAMETER RetryDelayMs
    Delay between retries.
.PARAMETER SkipPull
    Skip git pull (useful if already pulled).
#>
param(
    [string]$PropConnectionName = "",
    [string]$PipeName = "VincereOperator2",
    [int]$ConnectTimeoutMs = 20000,
    [int]$RetryAttempts = 8,
    [int]$RetryDelayMs = 400,
    [switch]$SkipPull
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Merge-EnvKey {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )
    $lines = @()
    if (Test-Path $Path) { $lines = @(Get-Content $Path -ErrorAction Stop) }
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
    if (-not $found) { [void]$out.Add("$Key=$Value") }
    $out | Set-Content -Path $Path -Encoding utf8
}

if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
    Write-Error "No .git folder found. Clone repo first."
}

if (-not $SkipPull) {
    Write-Host "git pull..." -ForegroundColor Cyan
    git pull
    if ($LASTEXITCODE -ne 0) { Write-Error "git pull failed." }
} else {
    Write-Host "SkipPull set; not pulling." -ForegroundColor Yellow
}

# 1) Ensure add-on source uses desired pipe name
$addonSrc = Join-Path $repoRoot "nt8-addon\VincereOperatorIpcAddOn.cs"
if (-not (Test-Path $addonSrc)) {
    Write-Error "Missing add-on source: $addonSrc"
}
$addonText = Get-Content $addonSrc -Raw -ErrorAction Stop
$pipeConstPattern = 'private const string PipeName\s*=\s*"[^"]+";'
$pipeConstNew = "private const string PipeName = `"$PipeName`";"
$addonText2 = [regex]::Replace($addonText, $pipeConstPattern, $pipeConstNew, 1)
if ($addonText2 -ne $addonText) {
    $addonText2 | Set-Content -Path $addonSrc -Encoding utf8
    Write-Host "Patched add-on pipe constant to: $PipeName" -ForegroundColor Cyan
} else {
    Write-Host "Add-on pipe constant already set (or pattern unchanged)." -ForegroundColor Yellow
}

# 2) Copy add-on into NinjaTrader folder(s)
$installAddon = Join-Path $PSScriptRoot "Install-VincereAddon.ps1"
& $installAddon -NoPause

# 3) Build + publish app (forces DRY_RUN=false by default in setup script)
$setup = Join-Path $PSScriptRoot "Setup-VincereOps.ps1"
& $setup -PublishDir (Join-Path $env:LOCALAPPDATA "Programs\VincereOps") -PropConnectionName $PropConnectionName -DryRun $false

# 4) Force IPC keys in runtime .env
$envPath = Join-Path (Join-Path $env:LOCALAPPDATA "Vincere.Operator") ".env"
if (-not (Test-Path $envPath)) {
    New-Item -ItemType File -Path $envPath -Force | Out-Null
}
Merge-EnvKey -Path $envPath -Key "VINCERE_IPC_PIPE_NAME" -Value $PipeName
Merge-EnvKey -Path $envPath -Key "VINCERE_IPC_CONNECT_MS" -Value "$ConnectTimeoutMs"
Merge-EnvKey -Path $envPath -Key "VINCERE_IPC_RETRY_ATTEMPTS" -Value "$RetryAttempts"
Merge-EnvKey -Path $envPath -Key "VINCERE_IPC_RETRY_DELAY_MS" -Value "$RetryDelayMs"
Merge-EnvKey -Path $envPath -Key "DRY_RUN" -Value "false"
if (-not [string]::IsNullOrWhiteSpace($PropConnectionName)) {
    Merge-EnvKey -Path $envPath -Key "PROP_CONNECTION_NAME" -Value $PropConnectionName.Trim()
}

Write-Host ""
Write-Host "Sync complete." -ForegroundColor Green
Write-Host "Next in NinjaTrader:" -ForegroundColor Yellow
Write-Host "  1) NinjaScript Editor -> Compile"
Write-Host "  2) Restart NinjaTrader"
Write-Host "  3) Run: .\scripts\Test-VincereIpcSmoke.cmd $PipeName"
