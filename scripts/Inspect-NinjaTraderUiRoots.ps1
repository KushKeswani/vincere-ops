param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\ninjatrader-ui-roots.txt"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function SafeRect($Rect) {
    if ($Rect.IsEmpty) { return "empty" }
    "{0},{1},{2},{3}" -f [int]$Rect.X, [int]$Rect.Y, [int]$Rect.Width, [int]$Rect.Height
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add("NinjaTrader UI roots $(Get-Date -Format s)") | Out-Null

foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $roots = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    for ($i = 0; $i -lt $roots.Count; $i++) {
        $root = $roots.Item($i)
        $current = $root.Current
        $lines.Add(("root pid={0} name='{1}' class='{2}' aid='{3}' rect={4}" -f $process.Id, $current.Name, $current.ClassName, $current.AutomationId, (SafeRect $current.BoundingRectangle))) | Out-Null
        foreach ($automationId in @("ControlCenter", "StrategiesGridTabItem", "StrategiesGrid")) {
            $item = $root.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $automationId))
            if ($null -ne $item) {
                $ic = $item.Current
                $lines.Add(("  {0} name='{1}' class='{2}' rect={3}" -f $automationId, $ic.Name, $ic.ClassName, (SafeRect $ic.BoundingRectangle))) | Out-Null
            }
        }
    }
}

Set-Content -Path $OutPath -Value $lines -Encoding UTF8
Write-Host $OutPath
