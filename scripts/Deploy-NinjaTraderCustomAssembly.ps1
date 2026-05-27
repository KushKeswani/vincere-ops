param(
    [string]$CustomRoot = "C:\Users\Administrator\Documents\NinjaTrader 8\bin\Custom",
    [string]$Configuration = "Release",
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$sourceRoot = Join-Path $CustomRoot "bin\$Configuration"
if (-not (Test-Path (Join-Path $sourceRoot "NinjaTrader.Custom.dll"))) {
    throw "Missing build output: $sourceRoot\NinjaTrader.Custom.dll"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = "C:\Users\Administrator\Desktop\vincere-ops\backups\ninjatrader-custom-$stamp"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

if ($Restart) {
    Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $_.CloseMainWindow() | Out-Null
            if (-not $_.WaitForExit(15000)) {
                Stop-Process -Id $_.Id -Force
            }
        }
        catch {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 3
}

$rootFiles = @("NinjaTrader.Custom.dll", "NinjaTrader.Custom.pdb", "NinjaTrader.Custom.XML")
foreach ($file in $rootFiles) {
    $dest = Join-Path $CustomRoot $file
    if (Test-Path $dest) {
        Copy-Item -Path $dest -Destination (Join-Path $backupRoot $file) -Force
    }
    Copy-Item -Path (Join-Path $sourceRoot $file) -Destination $dest -Force
}

$cultureDirs = Get-ChildItem -Path $sourceRoot -Directory
foreach ($dir in $cultureDirs) {
    $resource = Join-Path $dir.FullName "NinjaTrader.Custom.resources.dll"
    if (-not (Test-Path $resource)) {
        continue
    }

    $destDir = Join-Path $CustomRoot $dir.Name
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $destResource = Join-Path $destDir "NinjaTrader.Custom.resources.dll"
    $backupDir = Join-Path $backupRoot $dir.Name
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    if (Test-Path $destResource) {
        Copy-Item -Path $destResource -Destination (Join-Path $backupDir "NinjaTrader.Custom.resources.dll") -Force
    }
    Copy-Item -Path $resource -Destination $destResource -Force
}

if ($Restart) {
    Start-Process -FilePath "C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe"
}

Get-Item (Join-Path $CustomRoot "NinjaTrader.Custom.dll") |
    Select-Object FullName, LastWriteTime, Length
Write-Host "backupRoot=$backupRoot"
