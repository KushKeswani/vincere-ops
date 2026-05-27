param()

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Invoke-Element($Element) {
    $pattern = $null
    if ($null -ne $Element -and
        $Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return $true
    }
    return $false
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$closed = 0
foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $window = $windows.Item($i)
        if ($window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) { continue }

        $name = $window.Current.Name
        if ($name -notin @("Error", "Strategies")) { continue }

        $buttonName = if ($name -eq "Error") { "OK" } else { "Cancel" }
        $button = $window.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $buttonName))
        if (Invoke-Element $button) {
            $closed++
            Start-Sleep -Milliseconds 300
        }
    }
}

Write-Host "Closed $closed NinjaTrader modal dialog(s)."
