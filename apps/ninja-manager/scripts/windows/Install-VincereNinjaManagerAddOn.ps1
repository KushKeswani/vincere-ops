[CmdletBinding()]
param(
    [string]$NinjaTraderDocuments = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NinjaTrader 8'),
    [string]$NinjaTraderExecutable = (Join-Path $env:ProgramFiles 'NinjaTrader 8\bin\NinjaTrader.exe'),
    [string]$RequiredNinjaTraderVersion = '8.1.7.2',
    [ValidateRange(1, 20)] [int]$MinimumFreeSpaceGb = 3,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..\..\runtime\ninjatrader-addon\VincereNinjaManagerIpcAddOn.cs')).Path
$customRoot = Join-Path $NinjaTraderDocuments 'bin\Custom'
$customProject = Join-Path $customRoot 'NinjaTrader.Custom.csproj'
$relativeSource = 'AddOns\VincereNinjaManager\VincereNinjaManagerIpcAddOn.cs'
$destinationDirectory = Join-Path $customRoot 'AddOns\VincereNinjaManager'
$destination = Join-Path $customRoot $relativeSource
$running = Get-Process -Name 'NinjaTrader' -ErrorAction SilentlyContinue | Select-Object -First 1
$sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant()
$driveName = ([IO.Path]::GetPathRoot($customRoot)).TrimEnd('\').TrimEnd(':')
$drive = Get-PSDrive -Name $driveName -ErrorAction Stop
$minimumFreeBytes = [int64]$MinimumFreeSpaceGb * 1GB
$ninjaTraderVersion = if (Test-Path -LiteralPath $NinjaTraderExecutable) {
    (Get-Item -LiteralPath $NinjaTraderExecutable).VersionInfo.FileVersion
} else { $null }
$reportedNinjaTraderVersion = if ($ninjaTraderVersion) { $ninjaTraderVersion } else { 'not found' }

Write-Host "[Vincere Ninja Manager] Source: $source"
Write-Host "[Vincere Ninja Manager] Source SHA-256: $sourceHash"
Write-Host "[Vincere Ninja Manager] Destination: $destination"
Write-Host "[Vincere Ninja Manager] Custom project: $customProject"
Write-Host "[Vincere Ninja Manager] NinjaTrader version: $reportedNinjaTraderVersion"
Write-Host ("[Vincere Ninja Manager] Free space on {0}: {1:N2} GB" -f $driveName, ($drive.Free / 1GB))

if ($DryRun) {
    if ($running) { Write-Host "[Vincere Ninja Manager] DRY RUN: NinjaTrader is running (PID $($running.Id)); actual installation would refuse." }
    if ($drive.Free -lt $minimumFreeBytes) { Write-Host "[Vincere Ninja Manager] DRY RUN: actual installation would require at least $MinimumFreeSpaceGb GB free." }
    if ($ninjaTraderVersion -ne $RequiredNinjaTraderVersion) { Write-Host "[Vincere Ninja Manager] DRY RUN: actual installation would require NinjaTrader $RequiredNinjaTraderVersion." }
    Write-Host '[Vincere Ninja Manager] DRY RUN: no NinjaTrader file was changed.'
    return
}

if ($running) {
    throw "NinjaTrader is running (PID $($running.Id)). Close it during a supervised maintenance/SIM window before installing source."
}
if (-not (Test-Path -LiteralPath $NinjaTraderDocuments)) {
    throw "NinjaTrader documents directory was not found: $NinjaTraderDocuments"
}
if (-not (Test-Path -LiteralPath $customProject)) {
    throw "NinjaTrader Custom project was not found: $customProject"
}
if ($ninjaTraderVersion -ne $RequiredNinjaTraderVersion) {
    throw "NinjaTrader version mismatch. Required $RequiredNinjaTraderVersion; found $reportedNinjaTraderVersion."
}
if ($drive.Free -lt $minimumFreeBytes) {
    throw ("At least {0} GB free is required before changing the NinjaTrader Custom project; {1:N2} GB is available." -f $MinimumFreeSpaceGb, ($drive.Free / 1GB))
}

$backupStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$backupRoot = Join-Path $env:LOCALAPPDATA "Vincere\NinjaManager\backups\addon-$backupStamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$destinationExisted = Test-Path -LiteralPath $destination
Copy-Item -LiteralPath $customProject -Destination (Join-Path $backupRoot 'NinjaTrader.Custom.csproj')
foreach ($outputName in @('NinjaTrader.Custom.dll', 'NinjaTrader.Custom.pdb', 'NinjaTrader.Custom.XML')) {
    $output = Join-Path $customRoot "bin\Release\$outputName"
    if (Test-Path -LiteralPath $output) {
        Copy-Item -LiteralPath $output -Destination (Join-Path $backupRoot $outputName)
    }
}
if ($destinationExisted) {
    Copy-Item -LiteralPath $destination -Destination (Join-Path $backupRoot 'VincereNinjaManagerIpcAddOn.cs')
}

[xml]$project = Get-Content -Raw -LiteralPath $customProject
$projectElement = $project.Project
$reference = @($projectElement.ItemGroup.Reference | Where-Object { $_.Include -eq 'System.Runtime.Serialization' }) | Select-Object -First 1
if (-not $reference) {
    $referenceGroup = $projectElement.ItemGroup | Where-Object { $_.Reference } | Select-Object -First 1
    if (-not $referenceGroup) { throw 'NinjaTrader Custom project has no reference ItemGroup.' }
    $referenceNode = $project.CreateElement('Reference')
    $referenceNode.SetAttribute('Include', 'System.Runtime.Serialization')
    [void]$referenceGroup.AppendChild($referenceNode)
}
$compile = @($projectElement.ItemGroup.Compile | Where-Object { $_.Include -eq $relativeSource }) | Select-Object -First 1
if (-not $compile) {
    $compileGroup = $projectElement.ItemGroup | Where-Object { $_.Compile } | Select-Object -Last 1
    if (-not $compileGroup) { throw 'NinjaTrader Custom project has no compile ItemGroup.' }
    $compileNode = $project.CreateElement('Compile')
    $compileNode.SetAttribute('Include', $relativeSource)
    [void]$compileGroup.AppendChild($compileNode)
}

New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
$temporaryProject = "$customProject.$PID.tmp"
$project.Save($temporaryProject)
[void](Get-Content -Raw -LiteralPath $temporaryProject | ForEach-Object { [xml]$_ })
Move-Item -LiteralPath $temporaryProject -Destination $customProject -Force

$installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
if ($installedHash -ne $sourceHash) { throw 'Installed Add-On source hash does not match the repository source.' }
$manifest = [ordered]@{
    schemaVersion = 1
    installedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    ninjaTraderVersion = $ninjaTraderVersion
    sourceHashSha256 = $sourceHash
    customProject = $customProject
    destination = $destination
    destinationExisted = $destinationExisted
    backupRoot = $backupRoot
    compileInclude = $relativeSource
    referenceAdded = $null -eq $reference
}
$manifestPath = Join-Path $backupRoot 'install-manifest.json'
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "[Vincere Ninja Manager] Rollback manifest: $manifestPath"
Write-Host '[Vincere Ninja Manager] Add-On source and Custom project entry installed. Start NinjaTrader disconnected/SIM, open New > NinjaScript Editor, and press F5 to compile.'
