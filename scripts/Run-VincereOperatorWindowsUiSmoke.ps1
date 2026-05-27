<#
.SYNOPSIS
    Interactive-session wrapper for Test-VincereOperatorWindowsUi.ps1.

.DESCRIPTION
    Creates a timestamped log under ..\logs, runs the UI smoke test, and exits
    with the same status code. Use this wrapper from Task Scheduler because
    Scheduler command-line redirection is unreliable for UI test output.
#>
param(
    [switch]$IncludeLiveActions,
    [switch]$IncludeDestructiveActions,
    [string]$BlueprintPath = "",
    [switch]$CloseWhenDone
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot "logs"
$testScript = Join-Path $PSScriptRoot "Test-VincereOperatorWindowsUi.ps1"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logsDir "ui-smoke-$timestamp.log"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$exitCode = 1
Start-Transcript -Path $logPath -Force | Out-Null
try {
    Write-Host "UI smoke log: $logPath"

    $testArgs = @{}
    if ($IncludeLiveActions) { $testArgs["IncludeLiveActions"] = $true }
    if ($IncludeDestructiveActions) { $testArgs["IncludeDestructiveActions"] = $true }
    if (-not [string]::IsNullOrWhiteSpace($BlueprintPath)) {
        $testArgs["BlueprintPath"] = $BlueprintPath
    }
    if ($CloseWhenDone) { $testArgs["CloseWhenDone"] = $true }

    & $testScript @testArgs
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 0 }
}
catch {
    Write-Host ("Wrapper failed: " + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
}
finally {
    Stop-Transcript | Out-Null
    Write-Host "UI smoke log complete: $logPath"
}

exit $exitCode
