param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\ninjatrader-grid-counts.txt"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Invoke-Element($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label not found." }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
    } elseif ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
    } else {
        $Element.SetFocus()
    }
    Start-Sleep -Milliseconds 400
}

function Find-ControlCenter {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $window = $windows.Item($i)
            if ($window.Current.AutomationId -eq "ControlCenter" -or $window.Current.ClassName -eq "ControlCenter") {
                return $window
            }
        }
    }
    return $null
}

function Get-GridCount($ControlCenter, [string]$TabAutomationId, [string]$GridAutomationId) {
    $tab = $ControlCenter.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $TabAutomationId))
    Invoke-Element $tab $TabAutomationId
    $grid = $ControlCenter.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $GridAutomationId))
    if ($null -eq $grid) { return [pscustomobject]@{ Grid = $GridAutomationId; Count = -1; Sample = "grid not found" } }
    $rows = $grid.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::DataItem)))
    $sample = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt [Math]::Min(5, $rows.Count); $i++) {
        $name = $rows.Item($i).Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name)) { $sample.Add($name.Trim()) | Out-Null }
    }
    [pscustomobject]@{ Grid = $GridAutomationId; Count = $rows.Count; Sample = ($sample -join " | ") }
}

$cc = Find-ControlCenter
if ($null -eq $cc) { throw "Control Center not found." }

$results = @()
$results += Get-GridCount $cc "OrdersGridTabItem" "OrdersGrid"
$results += Get-GridCount $cc "PositionsGridTabItem" "PositionsGrid"
$results += Get-GridCount $cc "StrategiesGridTabItem" "StrategiesGrid"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$results | Format-Table -AutoSize | Out-String | Set-Content -Path $OutPath -Encoding UTF8
$results | Format-Table -AutoSize
