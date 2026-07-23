[CmdletBinding()]
param(
    [string]$DashboardUrl = 'http://127.0.0.1:3000',
    [string]$DatabaseUrl = '',
    [switch]$ArchiveExistingEnrollment,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$localRoot = Join-Path $env:LOCALAPPDATA 'Vincere\NinjaManager'
$secretRoot = Join-Path $localRoot 'secrets'
$configPath = Join-Path $localRoot 'companion.json'
$tokenPath = Join-Path $secretRoot 'agent-token.txt'
$ipcSecretPath = Join-Path $secretRoot 'ipc-secret.bin'
$identitySecretPath = Join-Path $secretRoot 'identity-secret.bin'
$statePath = Join-Path $localRoot 'state\companion-state.json'
$logPath = Join-Path $localRoot 'logs\companion.log'
$enrollmentScript = Join-Path $appRoot 'scripts\enroll-local-companion.ts'
if (-not $DatabaseUrl) {
    $DatabaseUrl = 'file://.data/operator-local-readiness'
}
if (-not $DatabaseUrl.StartsWith('file://')) {
    throw 'This local preparation script accepts only an embedded file:// database URL.'
}

function Protect-PathForCurrentUser([string]$Path, [bool]$IsDirectory) {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    if ($IsDirectory) {
        $security = New-Object Security.AccessControl.DirectorySecurity
        $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    }
    else {
        $security = New-Object Security.AccessControl.FileSecurity
        $inheritance = [Security.AccessControl.InheritanceFlags]::None
    }
    $security.SetOwner($currentSid)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        [void]$security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $security
}

foreach ($directory in @($localRoot, $secretRoot, (Split-Path $statePath -Parent), (Split-Path $logPath -Parent))) {
    if ($DryRun) { continue }
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Protect-PathForCurrentUser $directory $true
}

$existingEnrollmentMatches = $false
if (Test-Path -LiteralPath $configPath) {
    $existingConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    $existingEnrollmentMatches =
        $existingConfig.dashboardUrl -eq $DashboardUrl -and
        $existingConfig.enrollmentDatabaseUrl -eq $DatabaseUrl
    if (-not $existingEnrollmentMatches -and -not $ArchiveExistingEnrollment -and -not $DryRun) {
        throw "Existing companion enrollment targets a different or unknown database. Re-run with -ArchiveExistingEnrollment to preserve it and enroll against $DatabaseUrl."
    }
}

if ($DryRun) {
    Write-Host "[Vincere Ninja Manager] DRY RUN: would prepare $localRoot"
    Write-Host "[Vincere Ninja Manager] DRY RUN: enrollment target is $DashboardUrl using $DatabaseUrl"
    if ((Test-Path -LiteralPath $configPath) -and -not $existingEnrollmentMatches) {
        Write-Host '[Vincere Ninja Manager] DRY RUN: a real run would require -ArchiveExistingEnrollment before replacement.'
    }
    return
}

if ((Test-Path -LiteralPath $configPath) -and -not $existingEnrollmentMatches) {
    $backupStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
    $backupRoot = Join-Path $localRoot "backups\enrollment-$backupStamp"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Protect-PathForCurrentUser $backupRoot $true

    $archiveTargets = @($configPath, $tokenPath, $statePath, $logPath)
    foreach ($archiveTarget in $archiveTargets) {
        if (-not (Test-Path -LiteralPath $archiveTarget)) { continue }
        $relativePath = $archiveTarget.Substring($localRoot.Length).TrimStart('\')
        $archivePath = Join-Path $backupRoot $relativePath
        New-Item -ItemType Directory -Path (Split-Path $archivePath -Parent) -Force | Out-Null
        Move-Item -LiteralPath $archiveTarget -Destination $archivePath
        Protect-PathForCurrentUser $archivePath $false
    }
    Write-Host "[Vincere Ninja Manager] Archived the prior enrollment at $backupRoot"
}

$node = (Get-Command node.exe -ErrorAction Stop).Source

foreach ($secretPath in @($ipcSecretPath, $identitySecretPath)) {
    if (-not (Test-Path -LiteralPath $secretPath)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        [IO.File]::WriteAllBytes($secretPath, $bytes)
    }
    if ((Get-Item -LiteralPath $secretPath).Length -ne 32) {
        throw "Secret file must contain exactly 32 bytes: $secretPath"
    }
    Protect-PathForCurrentUser $secretPath $false
}

Push-Location $appRoot
$previousDatabaseUrl = $env:DATABASE_URL
try {
    $env:DATABASE_URL = $DatabaseUrl
    & $node --conditions=react-server --import tsx $enrollmentScript `
        --config $configPath `
        --token-file $tokenPath `
        --ipc-secret-file $ipcSecretPath `
        --identity-secret-file $identitySecretPath `
        --state-file $statePath `
        --log-file $logPath `
        --dashboard-url $DashboardUrl
    if ($LASTEXITCODE -ne 0) { throw 'Local companion enrollment failed.' }
}
finally {
    $env:DATABASE_URL = $previousDatabaseUrl
    Pop-Location
}

foreach ($filePath in @($configPath, $tokenPath)) {
    if (-not (Test-Path -LiteralPath $filePath)) { throw "Expected setup file was not created: $filePath" }
    Protect-PathForCurrentUser $filePath $false
}

Write-Host "[Vincere Ninja Manager] Read-only integration prepared: $configPath"
Write-Host "[Vincere Ninja Manager] Enrollment is bound to $DatabaseUrl"
Write-Host '[Vincere Ninja Manager] The Add-On has not been installed or compiled by this preparation step.'
