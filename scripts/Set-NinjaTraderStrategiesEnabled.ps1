param(
    [string]$Enabled = "true",
    [switch]$WhatIf,
    [int]$TimeoutSeconds = 18
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$targetEnabled = $Enabled -match "^(1|true|yes|on)$"

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Find-ControlCenter {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $window = $windows.Item($i)
            $name = $window.Current.Name
            $className = $window.Current.ClassName
            $automationId = $window.Current.AutomationId
            if ($automationId -eq "ControlCenter" -or $className -eq "ControlCenter" -or $name -like "*Control Center*" -or (Contains-ControlCenterControls $window)) {
                return $window
            }
        }
    }
    return $null
}

function Contains-ControlCenterControls($Element) {
    try {
        $condition = [System.Windows.Automation.OrCondition]::new(
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGridTabItem"),
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGrid"))
        return $null -ne $Element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    } catch {
        return $false
    }
}

function Select-StrategiesTab($ControlCenter) {
    $tab = $ControlCenter.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGridTabItem"))
    if ($null -eq $tab) { throw "NinjaTrader Strategies tab was not found." }

    $pattern = $null
    if ($tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
        return
    }
    if ($tab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    $tab.SetFocus()
}

function Test-OperableEnabled($Element) {
    try {
        return $Element.Current.IsEnabled
    } catch {
        return $false
    }
}

if (-not (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
    throw "NinjaTrader is not running."
}

$controlCenter = Find-ControlCenter
if ($null -eq $controlCenter) {
    throw "NinjaTrader Control Center was not found."
}

try { $controlCenter.SetFocus() } catch {}
Select-StrategiesTab $controlCenter
Start-Sleep -Milliseconds 300

$grid = $controlCenter.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGrid"))
if ($null -eq $grid) {
    throw "NinjaTrader Strategies grid was not found."
}

$checkboxes = $grid.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::CheckBox)))

$desired = if ($targetEnabled) { [System.Windows.Automation.ToggleState]::On } else { [System.Windows.Automation.ToggleState]::Off }
$visible = 0
$changed = 0

for ($i = 0; $i -lt $checkboxes.Count; $i++) {
    $checkbox = $checkboxes.Item($i)
    if (-not (Test-OperableEnabled $checkbox)) { continue }
    $pattern = $null
    if (-not $checkbox.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { continue }
    $visible++
    if ($pattern.Current.ToggleState -eq $desired) { continue }
    if (-not $WhatIf) {
        $pattern.Toggle()
    }
    $changed++
    Start-Sleep -Milliseconds 75
}

if ($visible -eq 0) {
    throw "No operable strategy Enabled checkboxes were found in NinjaTrader."
}

$action = if ($targetEnabled) { "enabled" } else { "disabled" }
if ($changed -eq 0) {
    Write-Host "All $visible strategy row(s) were already $action."
} elseif ($WhatIf) {
    Write-Host "WHATIF would set $changed of $visible strategy row(s) to $action."
} else {
    Write-Host "$action $changed of $visible strategy row(s)."
}
