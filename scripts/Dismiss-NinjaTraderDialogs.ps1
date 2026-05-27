param(
    [int]$MaxDialogs = 5
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$dismissed = 0

for ($attempt = 0; $attempt -lt $MaxDialogs; $attempt++) {
    $dialog = $null
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $window = $windows.Item($i)
            if ($window.Current.AutomationId -eq "NTMessageBox" -or $window.Current.Name -eq "Error") {
                $dialog = $window
                break
            }
        }
        if ($null -ne $dialog) { break }
    }

    if ($null -eq $dialog) { break }

    try { $dialog.SetFocus() } catch {}
    $ok = $dialog.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "NTMessageBoxOKButton"))
    if ($null -eq $ok) {
        $ok = $dialog.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "OK"))
    }

    if ($null -eq $ok) {
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    } else {
        $pattern = $null
        if ($ok.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
        } else {
            $ok.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        }
    }
    $dismissed++
    Start-Sleep -Milliseconds 500
}

Write-Host "Dismissed $dismissed NinjaTrader dialog(s)."
