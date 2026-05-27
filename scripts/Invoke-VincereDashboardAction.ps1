param(
    [ValidateSet("Start Manager", "Stop Manager", "Start NinjaTrader", "Stop NinjaTrader", "Connect All", "Disconnect All", "Enable Strategies", "Disable Strategies", "View Logs")]
    [string]$Action,
    [int]$WaitSeconds = 5,
    [switch]$ConfirmPrompt
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function New-ControlTypeCondition([System.Windows.Automation.ControlType]$ControlType) {
    New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) $ControlType
}

function New-NameCondition([string]$Name) {
    New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $Name
}

function Find-ByNameAndType($Root, [string]$Name, [System.Windows.Automation.ControlType]$Type) {
    $condition = [System.Windows.Automation.AndCondition]::new((New-NameCondition $Name), (New-ControlTypeCondition $Type))
    $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Select-Tab($Root, [string]$Name) {
    $tab = Find-ByNameAndType $Root $Name ([System.Windows.Automation.ControlType]::TabItem)
    if ($null -eq $tab) { throw "Tab not found: $Name" }
    $pattern = $null
    if ($tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
    } elseif ($tab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
    } else {
        $tab.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait(" ")
    }
    Start-Sleep -Milliseconds 500
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$manager = $null
foreach ($process in (Get-Process -Name "Vincere.Operator" -ErrorAction SilentlyContinue)) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $window = $windows.Item($i)
        if ($window.Current.Name -like "*Vincere*" -or $window.Current.Name -like "*Ninja Manager*") {
            $manager = $window
            break
        }
    }
    if ($null -ne $manager) { break }
}

if ($null -eq $manager) { throw "Vincere Ninja Manager window not found." }

try { $manager.SetFocus() } catch {}
Select-Tab $manager "Dashboard"

$button = Find-ByNameAndType $manager $Action ([System.Windows.Automation.ControlType]::Button)
if ($null -eq $button) { throw "Dashboard action not found: $Action" }
if (-not $button.Current.IsEnabled) { throw "Dashboard action is disabled: $Action" }

$pattern = $null
if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
} else {
    $button.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait(" ")
}

if ($ConfirmPrompt) {
    Start-Sleep -Milliseconds 700
    $yes = $desktop.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-NameCondition "Yes"))
    if ($null -ne $yes) {
        $yesPattern = $null
        if ($yes.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$yesPattern)) {
            $yesPattern.Invoke()
        } else {
            $yes.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        }
    }
}

Start-Sleep -Seconds $WaitSeconds
Write-Host "Invoked dashboard action: $Action"
