[CmdletBinding()]
param(
    [ValidateSet('Run', 'Once', 'Doctor')] [string]$Mode = 'Run',
    [ValidateSet('Auto', 'V1', 'V2')] [string]$DoctorProtocol,
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'Vincere\NinjaManager\companion.json'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script = Join-Path $appRoot 'scripts\companion.ts'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$modeArgument = $Mode.ToLowerInvariant()

if ($Mode -ne 'Doctor' -and $DoctorProtocol) {
    throw 'DoctorProtocol is valid only when Mode is Doctor.'
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Companion is not prepared; configuration is missing: $ConfigPath"
}
if ($DryRun) {
    $protocolSummary = if ($DoctorProtocol) { " with doctor protocol $DoctorProtocol" } else { '' }
    Write-Host "[Vincere Ninja Manager] DRY RUN: would start companion mode $Mode$protocolSummary using $ConfigPath"
    return
}

$arguments = @('--import', 'tsx', $script, $modeArgument, '--config', $ConfigPath)
if ($Mode -eq 'Doctor' -and $DoctorProtocol) {
    $arguments += @('--doctor-protocol', $DoctorProtocol.ToLowerInvariant())
}
if ($Mode -eq 'Run') {
    Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $appRoot -WindowStyle Hidden | Out-Null
    Write-Host '[Vincere Ninja Manager] Read-only companion start requested.'
}
else {
    & $node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Companion $Mode failed." }
}
