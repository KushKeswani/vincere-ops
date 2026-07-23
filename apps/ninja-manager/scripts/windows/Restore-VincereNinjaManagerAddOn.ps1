[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string]$ManifestPath,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Rollback manifest was not found: $ManifestPath" }
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { throw 'Unsupported rollback manifest schema.' }
$backupRoot = (Resolve-Path -LiteralPath $manifest.backupRoot).Path
$manifestRoot = (Resolve-Path -LiteralPath (Split-Path $ManifestPath -Parent)).Path
if ($backupRoot -ne $manifestRoot) { throw 'Rollback manifest backup path does not match its containing directory.' }
$expectedBackupBase = (Join-Path $env:LOCALAPPDATA 'Vincere\NinjaManager\backups\addon-')
if (-not $backupRoot.StartsWith($expectedBackupBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Rollback backup is outside the managed Ninja Manager backup directory.'
}
if (Get-Process -Name 'NinjaTrader' -ErrorAction SilentlyContinue) {
    throw 'NinjaTrader must be fully closed before restoring the Add-On backup.'
}
$projectBackup = Join-Path $backupRoot 'NinjaTrader.Custom.csproj'
if (-not (Test-Path -LiteralPath $projectBackup)) { throw 'Rollback Custom project backup is missing.' }

Write-Host "[Vincere Ninja Manager] Would restore Custom project: $($manifest.customProject)"
Write-Host "[Vincere Ninja Manager] Would restore/remove source: $($manifest.destination)"
if ($DryRun) {
    Write-Host '[Vincere Ninja Manager] DRY RUN: no NinjaTrader file was changed.'
    return
}

Copy-Item -LiteralPath $projectBackup -Destination $manifest.customProject -Force
$sourceBackup = Join-Path $backupRoot 'VincereNinjaManagerIpcAddOn.cs'
if ($manifest.destinationExisted) {
    if (-not (Test-Path -LiteralPath $sourceBackup)) { throw 'Rollback Add-On source backup is missing.' }
    Copy-Item -LiteralPath $sourceBackup -Destination $manifest.destination -Force
} elseif (Test-Path -LiteralPath $manifest.destination) {
    Remove-Item -LiteralPath $manifest.destination
}
foreach ($outputName in @('NinjaTrader.Custom.dll', 'NinjaTrader.Custom.pdb', 'NinjaTrader.Custom.XML')) {
    $outputBackup = Join-Path $backupRoot $outputName
    if (Test-Path -LiteralPath $outputBackup) {
        $output = Join-Path (Split-Path $manifest.customProject -Parent) "bin\Release\$outputName"
        Copy-Item -LiteralPath $outputBackup -Destination $output -Force
    }
}
Write-Host '[Vincere Ninja Manager] Add-On source, Custom project, and captured build outputs were restored.'
