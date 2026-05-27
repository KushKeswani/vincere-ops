param(
    [string[]]$NamePatterns = @("*NinjaScript Editor*", "Error")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$closed = 0

foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $window = $windows.Item($i)
        $name = $window.Current.Name
        $automationId = $window.Current.AutomationId
        if ($automationId -eq "ControlCenter" -or $window.Current.ClassName -eq "ControlCenter") { continue }

        $matches = $false
        foreach ($pattern in $NamePatterns) {
            if ($name -like $pattern -or $automationId -like $pattern) {
                $matches = $true
                break
            }
        }
        if (-not $matches) { continue }

        try { $window.SetFocus() } catch {}
        $patternObj = $null
        if ($window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$patternObj)) {
            $patternObj.Close()
        } else {
            [System.Windows.Forms.SendKeys]::SendWait("%{F4}")
        }
        $closed++
        Start-Sleep -Milliseconds 500
    }
}

Write-Host "Closed $closed NinjaTrader auxiliary window(s)."
