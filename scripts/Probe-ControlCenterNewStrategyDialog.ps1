param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\control-center-new-strategy-dialog.txt"
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
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    throw "$Label does not support InvokePattern."
}

function Get-ElementValue($Element) {
    try {
        $pattern = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            return $pattern.Current.Value
        }
    } catch {}
    return ""
}

function SafeRect($Rect) {
    if ($Rect.IsEmpty) { return "empty" }
    "{0},{1},{2},{3}" -f [int]$Rect.X, [int]$Rect.Y, [int]$Rect.Width, [int]$Rect.Height
}

function Format-Element($Element) {
    $current = $Element.Current
    $name = ($current.Name -replace "\r?\n", " ").Trim()
    $value = (Get-ElementValue $Element)
    if (-not [string]::IsNullOrWhiteSpace($value)) { $value = ($value -replace "\r?\n", " ").Trim() }
    $parts = @(
        $current.ControlType.ProgrammaticName,
        "enabled=$($current.IsEnabled)",
        "rect=$(SafeRect $current.BoundingRectangle)"
    )
    if (-not [string]::IsNullOrWhiteSpace($current.AutomationId)) { $parts += "automationId=$($current.AutomationId)" }
    if (-not [string]::IsNullOrWhiteSpace($current.ClassName)) { $parts += "class=$($current.ClassName)" }
    if (-not [string]::IsNullOrWhiteSpace($name)) { $parts += "name=$name" }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $parts += "value=$value" }
    $parts -join " | "
}

function Write-Tree($Element, [System.IO.StreamWriter]$Writer, [int]$Depth = 0, [int]$MaxDepth = 12) {
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return }
    $Writer.WriteLine(("  " * $Depth) + (Format-Element $Element))
    $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $children.Count; $i++) {
        Write-Tree $children.Item($i) $Writer ($Depth + 1) $MaxDepth
    }
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$newItem = $desktop.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "New Strategy..."))
if ($null -eq $newItem) {
    & "$PSScriptRoot\Probe-ControlCenterStrategiesTab.ps1" -OpenContextMenu | Out-Null
    Start-Sleep -Milliseconds 500
    $newItem = $desktop.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "New Strategy..."))
}

Invoke-Element $newItem "New Strategy menu item"
Start-Sleep -Seconds 2

$strategyWindow = $null
foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $items = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items.Item($i)
        if ($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
            ($item.Current.Name -like "*Strateg*" -or $item.Current.AutomationId -like "*Strateg*")) {
            $strategyWindow = $item
            break
        }
    }
    if ($null -ne $strategyWindow) { break }
}
if ($null -eq $strategyWindow) { throw "New Strategy dialog/window not found." }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$writer = [System.IO.StreamWriter]::new($OutPath, $false, [System.Text.Encoding]::UTF8)
try {
    $writer.WriteLine("Control Center New Strategy dialog $(Get-Date -Format s)")
    Write-Tree $strategyWindow $writer 0 14
}
finally {
    $writer.Dispose()
}

Write-Host $OutPath
