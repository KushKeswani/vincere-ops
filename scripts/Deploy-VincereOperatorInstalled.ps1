$ErrorActionPreference = "Stop"

$install = "C:\Users\Administrator\AppData\Local\Programs\VincereOps"
$repo = "C:\Users\Administrator\Desktop\vincere-ops"
$build = Join-Path $repo "src\Vincere.Operator\bin\Release\net10.0-windows"
$backupRoot = Join-Path $repo "backups"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $backupRoot ("VincereOps-installed-" + $stamp)

if (-not (Test-Path $build)) {
    throw "Build output not found: $build"
}

New-Item -ItemType Directory -Force -Path $install | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

Stop-Process -Name "Vincere.Operator" -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

if (Test-Path $install) {
    Copy-Item $install $backup -Recurse -Force
}

Copy-Item (Join-Path $build "*") $install -Recurse -Force

$exe = Join-Path $install "Vincere.Operator.exe"
if (-not (Test-Path $exe)) {
    throw "Installed executable not found after copy: $exe"
}

$taskName = "VincereOperatorRestartNow"
schtasks /Create /TN $taskName /SC ONCE /ST 23:59 /TR "`"$exe`"" /RU "Administrator" /IT /F | Out-Null
schtasks /Run /TN $taskName | Out-Null
Start-Sleep -Seconds 2
schtasks /Delete /TN $taskName /F | Out-Null

Write-Output "Deployed backup: $backup"
