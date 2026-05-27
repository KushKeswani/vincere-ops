param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\ninjatrader-ui-tree.txt",
    [int]$MaxDepth = 4,
    [string]$FlatWindowNamePattern = "NinjaScript Editor",
    [int]$MaxFlatItems = 4000
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null

function New-ProcessCondition {
    param([int]$ProcessId)
    New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $ProcessId
    )
}

function Write-Node {
    param(
        [System.Windows.Automation.AutomationElement]$Element,
        [int]$Depth,
        [System.IO.StreamWriter]$Writer
    )
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return }
    $indent = "  " * $Depth
    $Writer.WriteLine("$indent$(Format-Element $Element)")

    $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $children.Count; $i++) {
        Write-Node $children.Item($i) ($Depth + 1) $Writer
    }
}

function Get-ElementValue {
    param([System.Windows.Automation.AutomationElement]$Element)
    try {
        $patternObject = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {
            return $patternObject.Current.Value
        }
    }
    catch {
        return ""
    }
    return ""
}

function Format-Element {
    param([System.Windows.Automation.AutomationElement]$Element)

    $current = $Element.Current
    $name = ($current.Name -replace "\r?\n", " ").Trim()
    $type = $current.ControlType.ProgrammaticName
    $localizedType = $current.LocalizedControlType
    $automationId = $current.AutomationId
    $className = $current.ClassName
    $enabled = $current.IsEnabled
    $value = (Get-ElementValue $Element)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        $value = ($value -replace "\r?\n", " ").Trim()
    }

    $parts = @(
        $type,
        "localized=$localizedType",
        "enabled=$enabled"
    )
    if (-not [string]::IsNullOrWhiteSpace($automationId)) { $parts += "automationId=$automationId" }
    if (-not [string]::IsNullOrWhiteSpace($className)) { $parts += "class=$className" }
    if (-not [string]::IsNullOrWhiteSpace($name)) { $parts += "name=$name" }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $parts += "value=$value" }
    return ($parts -join " | ")
}

function Write-FlatDescendants {
    param(
        [System.Windows.Automation.AutomationElement]$Window,
        [System.IO.StreamWriter]$Writer
    )

    if ([string]::IsNullOrWhiteSpace($FlatWindowNamePattern)) { return }
    if ($Window.Current.Name -notlike "*$FlatWindowNamePattern*") { return }

    $Writer.WriteLine("")
    $Writer.WriteLine("FLAT DESCENDANTS: $($Window.Current.Name)")
    $remaining = [ref]$MaxFlatItems
    Write-FlatElementTree $Window $Writer 0 $remaining
    if ($remaining.Value -le 0) {
        $Writer.WriteLine("... truncated after $MaxFlatItems UI elements")
    }
}

function Write-FlatElementTree {
    param(
        [System.Windows.Automation.AutomationElement]$Element,
        [System.IO.StreamWriter]$Writer,
        [int]$Depth,
        [ref]$Remaining
    )

    if ($null -eq $Element -or $Depth -gt 18 -or $Remaining.Value -le 0) { return }
    $indent = "  " * $Depth
    $Writer.WriteLine("$indent$(Format-Element $Element)")
    $Remaining.Value--

    $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $children.Count; $i++) {
        Write-FlatElementTree $children.Item($i) $Writer ($Depth + 1) $Remaining
        if ($Remaining.Value -le 0) { return }
    }
}

function Write-MatchingFlatDescendantWindows {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [System.IO.StreamWriter]$Writer,
        [int]$Depth = 0
    )

    if ([string]::IsNullOrWhiteSpace($FlatWindowNamePattern)) { return }
    if ($Depth -gt 6) { return }

    Write-FlatDescendants $Root $Writer
    $children = $Root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $children.Count; $i++) {
        $element = $children.Item($i)
        if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
            $element.Current.Name -like "*$FlatWindowNamePattern*") {
            Write-FlatDescendants $element $Writer
        }
        Write-MatchingFlatDescendantWindows $element $Writer ($Depth + 1)
    }
}

$processes = Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue
$writer = [System.IO.StreamWriter]::new($OutPath, $false, [System.Text.Encoding]::UTF8)
try {
    $writer.WriteLine("NinjaTrader UI tree $(Get-Date -Format s)")
    $writer.WriteLine("Processes: " + (($processes | ForEach-Object { "$($_.Id)/session=$($_.SessionId)" }) -join ", "))
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement

    foreach ($process in $processes) {
        $writer.WriteLine("")
        $writer.WriteLine("PROCESS $($process.Id)")
        $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-ProcessCondition $process.Id))
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $window = $windows.Item($i)
            Write-Node $window 0 $writer
            Write-MatchingFlatDescendantWindows $window $writer
        }
    }
}
finally {
    $writer.Dispose()
}

Write-Host $OutPath
