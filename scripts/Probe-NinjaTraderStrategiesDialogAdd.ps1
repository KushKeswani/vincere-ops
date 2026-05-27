param(
    [string]$StrategyNameContains = "CDGN",
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\ninjatrader-strategy-dialog-after-add.txt"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
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

function Format-Element($Element) {
    $current = $Element.Current
    $name = ($current.Name -replace "\r?\n", " ").Trim()
    $value = (Get-ElementValue $Element)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        $value = ($value -replace "\r?\n", " ").Trim()
    }
    $parts = @(
        $current.ControlType.ProgrammaticName,
        "enabled=$($current.IsEnabled)"
    )
    if (-not [string]::IsNullOrWhiteSpace($current.AutomationId)) { $parts += "automationId=$($current.AutomationId)" }
    if (-not [string]::IsNullOrWhiteSpace($current.ClassName)) { $parts += "class=$($current.ClassName)" }
    if (-not [string]::IsNullOrWhiteSpace($name)) { $parts += "name=$name" }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $parts += "value=$value" }
    $parts -join " | "
}

function Write-Tree($Element, [System.IO.StreamWriter]$Writer, [int]$Depth = 0, [int]$MaxDepth = 14) {
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return }
    $Writer.WriteLine(("  " * $Depth) + (Format-Element $Element))
    $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $children.Count; $i++) {
        Write-Tree $children.Item($i) $Writer ($Depth + 1) $MaxDepth
    }
}

function Find-StrategiesDialog {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $items = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items.Item($i)
            if ($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
                $item.Current.Name -eq "Strategies") {
                return $item
            }
        }
    }
    return $null
}

function Find-DescendantByAutomationId($Root, [string]$AutomationId) {
    $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $AutomationId))
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

function Select-Element($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label not found." }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
        return
    }
    throw "$Label does not support SelectionItemPattern."
}

$dialog = Find-StrategiesDialog
if ($null -eq $dialog) { throw "Strategies dialog not found." }

$available = Find-DescendantByAutomationId $dialog "lstBoxAvailableItems"
if ($null -eq $available) { throw "Available strategy list not found." }

$items = $available.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$match = $null
for ($i = 0; $i -lt $items.Count; $i++) {
    $item = $items.Item($i)
    if ($item.Current.Name -like "*$StrategyNameContains*") {
        $match = $item
        break
    }
}
if ($null -eq $match) { throw "No available strategy matched '$StrategyNameContains'." }

Select-Element $match "Available strategy item"
Start-Sleep -Milliseconds 300
$add = $dialog.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "add"))
Invoke-Element $add "add button"
Start-Sleep -Seconds 1

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$writer = [System.IO.StreamWriter]::new($OutPath, $false, [System.Text.Encoding]::UTF8)
try {
    $writer.WriteLine("Strategy dialog after add $(Get-Date -Format s)")
    Write-Tree $dialog $writer 0 14
}
finally {
    $writer.Dispose()
}

$cancel = $dialog.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "Cancel"))
Invoke-Element $cancel "Cancel button"
Write-Host $OutPath
