[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$testRoot = $PSScriptRoot
$addOnSource = (Resolve-Path (Join-Path $testRoot '..\VincereNinjaManagerIpcAddOn.cs')).Path
$probeSource = (Resolve-Path (Join-Path $testRoot 'OfflineRuntimeV2Probe.cs')).Path
$ninjaTraderBin = 'C:\Program Files\NinjaTrader 8\bin'
$coreAssembly = Join-Path $ninjaTraderBin 'NinjaTrader.Core.dll'
$guiAssembly = Join-Path $ninjaTraderBin 'NinjaTrader.Gui.dll'
$frameworkRoot = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
$wpfRoot = Join-Path $frameworkRoot 'WPF'
$compiler = Join-Path $frameworkRoot 'csc.exe'
$probeExecutable = Join-Path $env:TEMP 'VincereNinjaManager.RuntimeV2.OfflineProbe.exe'

foreach ($required in @($compiler, $coreAssembly, $guiAssembly, $addOnSource, $probeSource)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required offline probe input is missing: $required"
    }
}

$references = @(
    (Join-Path $frameworkRoot 'System.dll'),
    (Join-Path $frameworkRoot 'System.Core.dll'),
    (Join-Path $frameworkRoot 'System.Runtime.Serialization.dll'),
    (Join-Path $frameworkRoot 'System.Xaml.dll'),
    (Join-Path $wpfRoot 'WindowsBase.dll'),
    (Join-Path $wpfRoot 'PresentationCore.dll'),
    (Join-Path $wpfRoot 'PresentationFramework.dll'),
    $coreAssembly,
    $guiAssembly
)
$referenceArguments = $references | ForEach-Object { "/reference:$_" }

& $compiler /nologo /target:exe "/out:$probeExecutable" `
    /main:Vincere.NinjaManager.OfflineTests.OfflineRuntimeV2Probe `
    $referenceArguments $addOnSource $probeSource
if ($LASTEXITCODE -ne 0) {
    throw "Offline Add-On compilation failed with exit code $LASTEXITCODE."
}

& $probeExecutable $addOnSource $ninjaTraderBin
if ($LASTEXITCODE -ne 0) {
    throw "Offline runtime-v2 probe failed with exit code $LASTEXITCODE."
}
