param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\vincere-ui-tree.txt"
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
            $value = $pattern.Current.Value
            if ($null -eq $value) { return "" }
            return $value
        }
    } catch {}
    return ""
}

function Format-Element($Element) {
    $current = $Element.Current
    $parts = @(
        $current.ControlType.ProgrammaticName,
        "enabled=$($current.IsEnabled)"
    )
    if (-not [string]::IsNullOrWhiteSpace($current.AutomationId)) { $parts += "automationId=$($current.AutomationId)" }
    if (-not [string]::IsNullOrWhiteSpace($current.ClassName)) { $parts += "class=$($current.ClassName)" }
    if (-not [string]::IsNullOrWhiteSpace($current.Name)) { $parts += "name=$($current.Name)" }
    $value = Get-ElementValue $Element
    if (-not [string]::IsNullOrWhiteSpace($value)) { $parts += "value=$value" }
    $parts -join " | "
}

function Write-Tree($Element, [System.IO.StreamWriter]$Writer, [int]$Depth = 0, [int]$MaxDepth = 8) {
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return }
    $Writer.WriteLine(("  " * $Depth) + (Format-Element $Element))
    try {
        $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        for ($i = 0; $i -lt $children.Count; $i++) {
            Write-Tree $children.Item($i) $Writer ($Depth + 1) $MaxDepth
        }
    } catch {}
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$writer = [System.IO.StreamWriter]::new($OutPath, $false, [System.Text.Encoding]::UTF8)
try {
    $writer.WriteLine("Vincere UI tree $(Get-Date -Format s)")
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process Vincere.Operator -ErrorAction SilentlyContinue)) {
        $writer.WriteLine("")
        $writer.WriteLine("PROCESS $($process.Id)")
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $items = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $items.Count; $i++) {
            Write-Tree $items.Item($i) $writer
        }
        if ($items.Count -eq 0) {
            $writer.WriteLine("No top-level UIA children found.")
        }
    }
}
finally {
    $writer.Dispose()
}

Write-Host $OutPath
