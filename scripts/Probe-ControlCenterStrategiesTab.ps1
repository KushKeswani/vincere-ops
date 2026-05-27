param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\control-center-strategies-tab.txt",
    [switch]$OpenContextMenu
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

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

function SafeRect($Rect) {
    if ($Rect.IsEmpty) { return "empty" }
    "{0},{1},{2},{3}" -f [int]$Rect.X, [int]$Rect.Y, [int]$Rect.Width, [int]$Rect.Height
}

function Format-Element($Element) {
    $current = $Element.Current
    $name = ($current.Name -replace "\r?\n", " ").Trim()
    $value = (Get-ElementValue $Element)
    if (-not [string]::IsNullOrWhiteSpace($value)) { $value = ($value -replace "\r?\n", " ").Trim() }
    $rect = $current.BoundingRectangle
    $parts = @(
        $current.ControlType.ProgrammaticName,
        "enabled=$($current.IsEnabled)",
        "rect=$(SafeRect $rect)"
    )
    if (-not [string]::IsNullOrWhiteSpace($current.AutomationId)) { $parts += "automationId=$($current.AutomationId)" }
    if (-not [string]::IsNullOrWhiteSpace($current.ClassName)) { $parts += "class=$($current.ClassName)" }
    if (-not [string]::IsNullOrWhiteSpace($name)) { $parts += "name=$name" }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $parts += "value=$value" }
    $parts -join " | "
}

function Write-Tree($Element, [System.IO.StreamWriter]$Writer, [int]$Depth = 0, [int]$MaxDepth = 10) {
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return }
    $Writer.WriteLine(("  " * $Depth) + (Format-Element $Element))
    $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $children.Count; $i++) {
        Write-Tree $children.Item($i) $Writer ($Depth + 1) $MaxDepth
    }
}

function Invoke-Element($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label not found." }
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

function Find-ControlCenter {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $items = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items.Item($i)
            if ($item.Current.AutomationId -eq "ControlCenter" -or $item.Current.ClassName -eq "ControlCenter") {
                return $item
            }
        }
    }
    return $null
}

$cc = Find-ControlCenter
if ($null -eq $cc) { throw "Control Center not found." }

$strategiesTab = $cc.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGridTabItem"))
Invoke-Element $strategiesTab "Strategies tab"
Start-Sleep -Milliseconds 500

$grid = $cc.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGrid"))

if ($OpenContextMenu -and $null -ne $grid) {
    $rect = $grid.Current.BoundingRectangle
    $x = [int]($rect.X + [Math]::Max(20, $rect.Width / 2))
    $y = [int]($rect.Y + [Math]::Max(20, $rect.Height / 2))
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    $sig = @'
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
    Add-Type -MemberDefinition $sig -Name WinMouse -Namespace Native
    [Native.WinMouse]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
    [Native.WinMouse]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 600
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$writer = [System.IO.StreamWriter]::new($OutPath, $false, [System.Text.Encoding]::UTF8)
try {
    $writer.WriteLine("Control Center Strategies tab $(Get-Date -Format s)")
    Write-Tree $cc $writer 0 10
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $writer.WriteLine("")
    $writer.WriteLine("DESKTOP POPUPS")
    Write-Tree $desktop $writer 0 3
}
finally {
    $writer.Dispose()
}

Write-Host $OutPath
