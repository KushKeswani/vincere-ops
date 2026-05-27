param(
    [int]$TimeoutSeconds = 15
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Find-DescendantByAutomationId($Root, [string]$AutomationId) {
    $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $AutomationId))
}

function Invoke-Element($Element, [string]$Label) {
    if ($null -eq $Element) {
        throw "$Label not found."
    }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    throw "$Label does not support InvokePattern."
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$processes = Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue
if ($processes.Count -eq 0) {
    throw "NinjaTrader process not found."
}

$button = $null
foreach ($process in $processes) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $roots = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    for ($i = 0; $i -lt $roots.Count; $i++) {
        $candidate = Find-DescendantByAutomationId $roots.Item($i) "ChartWindowStrategiesButton"
        if ($null -ne $candidate -and $candidate.Current.IsEnabled) {
            $button = $candidate
            break
        }
    }
    if ($null -ne $button) { break }
}

Invoke-Element $button "Chart strategies button"
Start-Sleep -Milliseconds 700
Write-Host "Opened chart Strategies dialog."
