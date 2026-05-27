param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\ninjatrader-ui-discovery.json",
    [int]$MaxDepth = 10
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Get-ElementName($Element) {
    try {
        $value = $Element.Current.Name
        if ($null -eq $value) { return "" }
        return $value
    } catch { return "" }
}

function Get-ElementAutomationId($Element) {
    try {
        $value = $Element.Current.AutomationId
        if ($null -eq $value) { return "" }
        return $value
    } catch { return "" }
}

function Get-ElementClassName($Element) {
    try {
        $value = $Element.Current.ClassName
        if ($null -eq $value) { return "" }
        return $value
    } catch { return "" }
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

function Add-ScanText([string]$Value, $Connections, $Accounts, [ref]$SawXml) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return }

    if ($Value.Contains("<NinjaTrader>")) {
        $SawXml.Value = $true
        try {
            $document = [xml]$Value
            foreach ($node in $document.SelectNodes("//Connection/Name")) {
                $name = $node.InnerText
                if ($null -eq $name) { $name = "" }
                $name = $name.Trim()
                if ($name.Length -gt 0) { [void]$Connections.Add($name) }
            }
        } catch {}
    }

    foreach ($match in [regex]::Matches($Value, "\b(?:[A-Z]{2,5}\d{6,}|Sim\d{2,4}|Playback\d{2,4}|Backtest)\b", "IgnoreCase")) {
        [void]$Accounts.Add($match.Value.Trim())
    }

    if ($Value -match "^(Apex|Lucid|Topstep|Take Profit|MyFundedFutures|Tradeify|Earn2Trade|BluSky|TickTickTrader|NinjaTrader)$") {
        [void]$Connections.Add($Value.Trim())
    }
}

function Scan-Element($Element, $Connections, $Accounts, [ref]$SawXml, [int]$Depth = 0) {
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return }

    Add-ScanText (Get-ElementName $Element) $Connections $Accounts $SawXml
    Add-ScanText (Get-ElementValue $Element) $Connections $Accounts $SawXml

    try {
        $children = $Element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        for ($i = 0; $i -lt $children.Count; $i++) {
            Scan-Element $children.Item($i) $Connections $Accounts $SawXml ($Depth + 1)
        }
    } catch {}
}

function Find-ControlCenter {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $items = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items.Item($i)
            if ((Get-ElementAutomationId $item) -eq "ControlCenter" -or (Get-ElementClassName $item) -eq "ControlCenter") {
                return $item
            }
        }
    }
    return $null
}

function Try-SelectTab($Root, [string]$AutomationId) {
    try {
        $tab = $Root.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $AutomationId))
        if ($null -eq $tab) { return $false }
        $pattern = $null
        if ($tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
            $pattern.Select()
            return $true
        }
        if ($tab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
            return $true
        }
    } catch {}
    return $false
}

function Try-OpenConnectionsMenu($Root) {
    try {
        $menu = $Root.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "ControlCenterMenuItemConnections"))
        if ($null -eq $menu) { return $false }
        $pattern = $null
        if ($menu.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
            $pattern.Expand()
            return $true
        }
        if ($menu.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
            return $true
        }
    } catch {}
    return $false
}

function Scan-ScrollableElements($Root, $Connections, $Accounts, [ref]$SawXml) {
    try {
        $items = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    } catch {
        return
    }

    for ($i = 0; $i -lt $items.Count; $i++) {
        $element = $items.Item($i)
        try {
            $pattern = $null
            if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) { continue }
            if (-not $pattern.Current.VerticallyScrollable) { continue }

            try {
                $pattern.SetScrollPercent([System.Windows.Automation.ScrollPattern]::NoScroll, 0)
                Start-Sleep -Milliseconds 150
            } catch {}

            $previous = [double]::NaN
            for ($n = 0; $n -lt 40; $n++) {
                Scan-Element $Root $Connections $Accounts $SawXml
                $current = $pattern.Current.VerticalScrollPercent
                if (-not [double]::IsNaN($previous) -and [Math]::Abs($current - $previous) -lt 0.01) { break }
                $previous = $current
                $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeIncrement)
                Start-Sleep -Milliseconds 150
            }
        } catch {}
    }
}

$connections = [System.Collections.Generic.SortedSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$accounts = [System.Collections.Generic.SortedSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$sawXml = $false
$details = [System.Collections.Generic.List[string]]::new()
$cc = Find-ControlCenter

if ($null -eq $cc) {
    $details.Add("Control Center not found.") | Out-Null
} else {
    $details.Add("Control Center found.") | Out-Null
    Scan-Element $cc $connections $accounts ([ref]$sawXml)

    if (Try-SelectTab $cc "AccountsGridTabItem") {
        Start-Sleep -Milliseconds 500
        $details.Add("Selected Accounts tab.") | Out-Null
        Scan-Element $cc $connections $accounts ([ref]$sawXml)
        Scan-ScrollableElements $cc $connections $accounts ([ref]$sawXml)
    }

    if (Try-OpenConnectionsMenu $cc) {
        Start-Sleep -Milliseconds 500
        $details.Add("Opened Connections menu.") | Out-Null
        Scan-Element ([System.Windows.Automation.AutomationElement]::RootElement) $connections $accounts ([ref]$sawXml) 0
    }
}

$result = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    connections = @($connections)
    accounts = @($accounts)
    sawControlCenterXml = $sawXml
    details = @($details)
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutPath) | Out-Null
$result | ConvertTo-Json -Depth 4 | Set-Content -Path $OutPath -Encoding UTF8
Write-Host $OutPath
