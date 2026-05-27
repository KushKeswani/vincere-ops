param(
    [string]$AppPath = "$env:LOCALAPPDATA\Programs\VincereOps\Vincere.Operator.exe",
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-NameCondition([string]$Name) {
    New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::NameProperty), $Name
}

function New-ControlTypeCondition([System.Windows.Automation.ControlType]$Type) {
    New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), $Type
}

function Find-NamedControl($Root, [string]$Name, [System.Windows.Automation.ControlType]$Type) {
    $condition = New-Object System.Windows.Automation.AndCondition `
        (New-NameCondition $Name), (New-ControlTypeCondition $Type)
    $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Invoke-Element($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label was not found." }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
        return
    }
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    throw "$Label is not invokable."
}

function Get-UiText($Root) {
    $elements = $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    $names = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $elements.Count; $i++) {
        $name = $elements.Item($i).Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $names.Add($name) | Out-Null
        }
    }
    ($names | Select-Object -Unique) -join "`n"
}

$process = Get-Process Vincere.Operator -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $process) {
    $process = Start-Process -FilePath $AppPath -PassThru
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$root = $null
do {
    $condition = New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), $process.Id
    $root = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        $condition)
    if ($null -ne $root) { break }
    Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)

if ($null -eq $root) { throw "Vincere main window was not found." }

Invoke-Element (Find-NamedControl $root "Settings" ([System.Windows.Automation.ControlType]::TabItem)) "Settings tab"
Start-Sleep -Milliseconds 500
Invoke-Element (Find-NamedControl $root "Scan NinjaTrader" ([System.Windows.Automation.ControlType]::Button)) "Scan NinjaTrader button"

$status = ""
$deadline = (Get-Date).AddSeconds(15)
do {
    Start-Sleep -Milliseconds 500
    $text = Get-UiText $root
    $match = [regex]::Match($text, "Found (?<connections>\d+) connection\(s\) and (?<accounts>\d+) account\(s\).*")
    if ($match.Success) {
        $status = $match.Value
        $connections = [int]$match.Groups["connections"].Value
        $accounts = [int]$match.Groups["accounts"].Value
        Write-Host $status
        if ($connections -lt 1) { throw "Expected at least one connection." }
        if ($accounts -lt 1) { throw "Expected at least one account." }
        exit 0
    }
} while ((Get-Date) -lt $deadline)

Write-Host (Get-UiText $root)
throw "Scan status was not found."
