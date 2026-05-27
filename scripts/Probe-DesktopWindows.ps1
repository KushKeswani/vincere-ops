param(
    [string]$OutputPath = "C:\ProgramData\VincereDesktopWindows.txt"
)

$ErrorActionPreference = "Stop"

function Format-Rect {
    param($Rect)
    if ($null -eq $Rect) {
        return "<null>"
    }
    return "{0},{1},{2},{3}" -f [int]$Rect.Left, [int]$Rect.Top, [int]$Rect.Width, [int]$Rect.Height
}

function Get-ElementLine {
    param($Element, [string]$Prefix)
    $current = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($Element)
    $parentName = ""
    if ($null -ne $current) {
        $parentName = $current.Current.Name
    }
    "{0}type={1} name={2} class={3} automationId={4} enabled={5} pid={6} rect={7} parent={8}" -f `
        $Prefix,
        $Element.Current.ControlType.ProgrammaticName,
        $Element.Current.Name,
        $Element.Current.ClassName,
        $Element.Current.AutomationId,
        $Element.Current.IsEnabled,
        $Element.Current.ProcessId,
        (Format-Rect $Element.Current.BoundingRectangle),
        $parentName
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Captured: $(Get-Date -Format o)") | Out-Null

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
    )

    foreach ($window in $windows) {
        try {
            $lines.Add((Get-ElementLine $window "WINDOW ")) | Out-Null

            $desc = $window.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            foreach ($item in $desc) {
                try {
                    $name = $item.Current.Name
                    $type = $item.Current.ControlType.ProgrammaticName
                    if ($type -eq "ControlType.Button" -or $name -match "^(OK|Yes|No|Cancel|Close|Shut Down NinjaTrader|Add All to NinjaTrader|Error)$") {
                        $lines.Add((Get-ElementLine $item "  ITEM ")) | Out-Null
                    }
                } catch {
                    $lines.Add("  ITEM_ERROR $($_.Exception.Message)") | Out-Null
                }
            }
        } catch {
            $lines.Add("WINDOW_ERROR $($_.Exception.Message)") | Out-Null
        }
    }
} catch {
    $lines.Add("FATAL $($_.Exception.GetType().FullName): $($_.Exception.Message)") | Out-Null
}

Set-Content -Path $OutputPath -Value $lines -Encoding UTF8
Write-Host "Wrote $($lines.Count) line(s) to $OutputPath"
