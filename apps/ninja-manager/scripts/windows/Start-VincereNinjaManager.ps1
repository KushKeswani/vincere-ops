[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)] [int]$Port = 3000,
    [ValidateRange(10, 300)] [int]$StartupTimeoutSeconds = 90,
    [string]$DatabaseUrl = '',
    [string]$NinjaTraderPath = '',
    [switch]$SkipNinjaTrader,
    [switch]$SkipCompanion,
    [switch]$SkipBrowser,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $DatabaseUrl) {
    $DatabaseUrl = 'file://.data/operator-local-readiness'
}
if (-not $DatabaseUrl.StartsWith('file://')) {
    throw 'The desktop development launcher accepts only an embedded file:// database URL.'
}
$healthUrl = "http://127.0.0.1:$Port/api/health"
$dashboardUrl = "http://127.0.0.1:$Port/"
$logDirectory = Join-Path $env:LOCALAPPDATA 'Vincere\NinjaManager\logs'
$logPath = Join-Path $logDirectory 'launcher.log'

function Write-LauncherStatus([string]$Message) {
    $line = '{0:u} {1}' -f (Get-Date), $Message
    Write-Host "[Vincere Ninja Manager] $Message"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        Add-Content -LiteralPath $logPath -Value $line
    }
}

function Test-DashboardHealth {
    try {
        $response = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 3
        return $response.status -eq 'healthy' -and $response.service -eq 'vincere-ninja-manager'
    }
    catch { return $false }
}

function Test-LocalPortInUse {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::', '::1') } |
        Select-Object -First 1
    return $null -ne $listener
}

Write-LauncherStatus "Launcher requested for the loopback dashboard on port $Port."

if (-not (Test-DashboardHealth)) {
    if (Test-LocalPortInUse) {
        throw "Port $Port is occupied, but the Ninja Manager health check failed. No process was stopped."
    }

    if ($DryRun) {
        Write-LauncherStatus "DRY RUN: would run 'npm run dev:local -- --port $Port' from $appRoot in a hidden window."
    }
    else {
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        $escapedRoot = $appRoot.Replace("'", "''")
        $escapedNpm = $npm.Replace("'", "''")
        $escapedDatabaseUrl = $DatabaseUrl.Replace("'", "''")
        $childCommand = "Set-Location -LiteralPath '$escapedRoot'; `$env:DATABASE_URL='$escapedDatabaseUrl'; & '$escapedNpm' run dev:local -- --port $Port"
        $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
        Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $encodedCommand
        ) -WindowStyle Hidden | Out-Null

        $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
        do {
            Start-Sleep -Milliseconds 500
            if (Test-DashboardHealth) { break }
        } while ((Get-Date) -lt $deadline)

        if (-not (Test-DashboardHealth)) {
            throw "The dashboard did not become healthy at $healthUrl within $StartupTimeoutSeconds seconds."
        }
        Write-LauncherStatus 'Dashboard is healthy.'
    }
}
else {
    Write-LauncherStatus 'Dashboard is already healthy; reusing the running instance.'
}

if (-not $SkipBrowser) {
    if ($DryRun) { Write-LauncherStatus "DRY RUN: would open $dashboardUrl in the default browser." }
    else { Start-Process $dashboardUrl | Out-Null }
}

if (-not $SkipNinjaTrader) {
    $runningNinjaTrader = Get-Process -Name 'NinjaTrader' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($runningNinjaTrader) {
        Write-LauncherStatus "NinjaTrader is already running (PID $($runningNinjaTrader.Id)); leaving it unchanged."
    }
    else {
        if (-not $NinjaTraderPath) {
            $NinjaTraderPath = Join-Path $env:ProgramFiles 'NinjaTrader 8\bin\NinjaTrader.exe'
        }
        if (-not (Test-Path -LiteralPath $NinjaTraderPath)) {
            throw "NinjaTrader was not found at $NinjaTraderPath."
        }
        if ($DryRun) { Write-LauncherStatus "DRY RUN: would start $NinjaTraderPath visibly." }
        else {
            Start-Process -FilePath $NinjaTraderPath | Out-Null
            Write-LauncherStatus 'NinjaTrader launch requested.'
        }
    }
}

$companionConfig = Join-Path $env:LOCALAPPDATA 'Vincere\NinjaManager\companion.json'
$companionLauncher = Join-Path $PSScriptRoot 'Start-VincereNinjaManagerCompanion.ps1'
if ($SkipCompanion) {
    Write-LauncherStatus 'Companion startup skipped by request.'
}
elseif (Test-Path -LiteralPath $companionConfig) {
    if ($DryRun) {
        Write-LauncherStatus "DRY RUN: would start the configured read-only companion using $companionConfig."
    }
    else {
        & $companionLauncher -Mode Run -ConfigPath $companionConfig
        Write-LauncherStatus 'Read-only companion start requested.'
    }
}
else {
    Write-LauncherStatus 'Companion is not prepared yet; dashboard and NinjaTrader startup remain available.'
}

Write-LauncherStatus 'Launcher completed.'
