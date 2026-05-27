param(
    [Parameter(Mandatory = $true)]
    [string]$StackJsonPath,
    [switch]$WhatIf,
    [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$payload = Get-Content -Raw -Path $StackJsonPath | ConvertFrom-Json
$results = New-Object 'System.Collections.Generic.List[string]'

if (-not ("Native.WinUi" -as [type])) {
    $winSig = @'
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
    Add-Type -MemberDefinition $winSig -Name WinUi -Namespace Native
}

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Find-DescendantByAutomationId($Root, [string]$AutomationId) {
    if ($null -eq $Root) { return $null }
    $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $AutomationId))
}

function Find-DescendantByName($Root, [string]$Name) {
    if ($null -eq $Root) { return $null }
    $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $Name))
}

function Find-VisibleDescendantByName($Root, [string]$Name) {
    if ($null -eq $Root) { return $null }
    $items = $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $Name))
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items.Item($i)
        if (Test-ElementVisible $item) { return $item }
    }
    if ($items.Count -gt 0) { return $items.Item(0) }
    return $null
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

function Invoke-OrClickElement($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label not found." }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    if (Test-ElementVisible $Element) {
        Click-ElementCenter $Element $Label
        return
    }
    try {
        $Element.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait(" ")
        return
    } catch {}
    throw "$Label does not support InvokePattern and is not clickable."
}

function Select-Element($Element, [string]$Label) {
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
    $Element.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait(" ")
}

function Set-ElementValue($Element, [string]$Value, [string]$Label) {
    if ($null -eq $Element) { throw "$Label not found." }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $pattern.SetValue($Value)
        return
    }
    $Element.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    [System.Windows.Forms.SendKeys]::SendWait($Value)
}

function Normalize-Name([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    ([regex]::Replace($Value, "[^A-Za-z0-9]", "")).ToUpperInvariant()
}

function Get-StrategyMatchKey([string]$Value) {
    $normalized = Normalize-Name $Value
    if ([string]::IsNullOrWhiteSpace($normalized)) { return "" }
    $withoutPropFirm = $normalized -replace "PF", ""
    if ($withoutPropFirm -match "^[A-Z]+") { return $Matches[0] }
    return $withoutPropFirm
}

function Test-PropFirmStrategyName([string]$CandidateName, [string]$RequestedStrategy) {
    $candidate = Normalize-Name $CandidateName
    $requested = Get-StrategyMatchKey $RequestedStrategy
    return -not [string]::IsNullOrWhiteSpace($requested) -and $candidate.StartsWith($requested + "PF")
}

function Get-DefaultInstrumentForStrategy([string]$StrategyType) {
    $key = Get-StrategyMatchKey $StrategyType
    switch ($key) {
        "ARPD" { return "MGC" }
        "CDGN" { return "CL" }
        "DJDR" { return "YM" }
        "FSA" { return "MNQ" }
        "IFSP" { return "NG" }
        "MST" { return "YM" }
        "OGX" { return "MNQ" }
        "PLPI" { return "PL" }
        "RBO" { return "M2K" }
        "SYFY" { return "MES" }
        "TDC" { return "MNQ" }
        default { return "" }
    }
}

function Resolve-InstrumentForStrategy([string]$StrategyType, [string]$Instrument) {
    $expectedRoot = Get-DefaultInstrumentForStrategy $StrategyType
    $candidate = if ($null -eq $Instrument) { "" } else { $Instrument.Trim() }
    if ([string]::IsNullOrWhiteSpace($expectedRoot)) { return $candidate }
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $expectedRoot }
    if ((Normalize-Name $candidate).StartsWith((Normalize-Name $expectedRoot))) { return $candidate }
    return $expectedRoot
}

function Test-NinjaTraderAccountId([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $trimmed = $Value.Trim()
    return (
        $trimmed.StartsWith("APEX", [System.StringComparison]::OrdinalIgnoreCase) -or
        $trimmed.StartsWith("LFE", [System.StringComparison]::OrdinalIgnoreCase) -or
        $trimmed.StartsWith("LTD", [System.StringComparison]::OrdinalIgnoreCase) -or
        $trimmed.StartsWith("SIM", [System.StringComparison]::OrdinalIgnoreCase)
    )
}

function Resolve-SetupAccount([string]$StrategyAccount, [string]$FallbackAccount) {
    if (Test-NinjaTraderAccountId $StrategyAccount) { return $StrategyAccount.Trim() }
    if (Test-NinjaTraderAccountId $FallbackAccount) { return $FallbackAccount.Trim() }
    if (-not [string]::IsNullOrWhiteSpace($StrategyAccount)) { return $StrategyAccount.Trim() }
    return $FallbackAccount
}

function Get-NinjaTraderRoots {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $roots = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $children = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $children.Count; $i++) {
            $roots.Add($children.Item($i)) | Out-Null
        }
    }
    $roots
}

function Find-ControlCenter {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $roots = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $roots.Count; $i++) {
            $root = $roots.Item($i)
            $isControlCenterRoot = (
                $root.Current.AutomationId -eq "ControlCenter" -or
                $root.Current.ClassName -eq "ControlCenter" -or
                $root.Current.Name -like "NINJATRADER*"
            )
            $controlCenter = $null
            if (-not $isControlCenterRoot) {
                $controlCenter = $root.FindFirst(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    [System.Windows.Automation.OrCondition]::new(
                        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "ControlCenter"),
                        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty) "ControlCenter")))
            }
            if ($isControlCenterRoot) {
                return $root
            }
            if ($null -ne $controlCenter) {
                return $controlCenter
            }
        }
    }

    $topLevel = $desktop.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $topLevel.Count; $i++) {
        $root = $topLevel.Item($i)
        $name = [string]$root.Current.Name
        $className = [string]$root.Current.ClassName
        $automationId = [string]$root.Current.AutomationId
        if ($automationId -eq "ControlCenter" -or $className -eq "ControlCenter" -or $name -like "NINJATRADER*") {
            return $root
        }

        $controlCenter = $root.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.OrCondition]::new(
                (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "ControlCenter"),
                (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty) "ControlCenter"),
                (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "NINJATRADER")))
        if ($null -ne $controlCenter) {
            return $controlCenter
        }
    }
    return $null
}

function Wait-ControlCenter([int]$Seconds = 12) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $controlCenter = Find-ControlCenter
        if ($null -ne $controlCenter) { return $controlCenter }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $null
}

function Bring-ToForeground($Element) {
    if ($null -eq $Element) { return }
    $handle = $Element.Current.NativeWindowHandle
    if ($handle -ne 0) {
        [Native.WinUi]::ShowWindow([IntPtr]$handle, 9) | Out-Null
        Start-Sleep -Milliseconds 150
        [Native.WinUi]::SetForegroundWindow([IntPtr]$handle) | Out-Null
        Start-Sleep -Milliseconds 250
    }
    try { $Element.SetFocus() } catch {}
}

function Close-Window($Window, [string]$Label) {
    if ($null -eq $Window) { return }
    $pattern = $null
    if ($Window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) {
        $pattern.Close()
        Start-Sleep -Milliseconds 500
        return
    }

    $close = Find-DescendantByAutomationId $Window "NTWindowButtonClose"
    if ($null -eq $close) { $close = Find-DescendantByName $Window "Close" }
    if ($null -ne $close) {
        Invoke-Element $close "$Label close button"
        Start-Sleep -Milliseconds 500
    }
}

function Close-BlockingNinjaTraderWindows {
    $namesToClose = @("Historical Data", "NinjaScript Editor")
    foreach ($root in (Get-NinjaTraderRoots)) {
        if ($namesToClose -contains $root.Current.Name) {
            Close-Window $root $root.Current.Name
            continue
        }

        $windows = $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Window)))
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $window = $windows.Item($i)
            if ($namesToClose -contains $window.Current.Name) {
                Close-Window $window $window.Current.Name
            }
        }
    }
}

function Click-ElementCenter($Element, [string]$Label, [string]$Button = "left") {
    if ($null -eq $Element) { throw "$Label not found." }
    $rect = $Element.Current.BoundingRectangle
    if ($rect.IsEmpty) { throw "$Label is not visible." }
    $x = [int]($rect.X + ($rect.Width / 2))
    $y = [int]($rect.Y + ($rect.Height / 2))
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    if ($Button -eq "right") {
        [Native.WinUi]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
        [Native.WinUi]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    } else {
        [Native.WinUi]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [Native.WinUi]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
}

function Test-ElementVisible($Element) {
    if ($null -eq $Element) { return $false }
    try {
        return -not $Element.Current.BoundingRectangle.IsEmpty
    }
    catch {
        return $false
    }
}

function Test-ElementEnabled($Element) {
    if ($null -eq $Element) { return $false }
    try {
        return $Element.Current.IsEnabled
    }
    catch {
        return $false
    }
}

function Get-InstrumentRoot([string]$Instrument) {
    if ([string]::IsNullOrWhiteSpace($Instrument)) { return "" }
    $candidate = $Instrument.Trim().ToUpperInvariant()
    if ($candidate -match "^([A-Z0-9]+)") { return $Matches[1] }
    return $candidate
}

function Resolve-CurrentContractName([string]$InstrumentRoot) {
    $root = $InstrumentRoot.Trim().ToUpperInvariant()
    $now = Get-Date
    $month = $now.Month
    $year = $now.Year

    if ($root -in @("ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K")) {
        $contractMonth = @(3, 6, 9, 12) | Where-Object { $_ -ge $month } | Select-Object -First 1
        if ($null -eq $contractMonth) {
            $contractMonth = 3
            $year++
        }
        return "$root $(([datetime]::new($year, $contractMonth, 1)).ToString('MMM').ToUpperInvariant())$($year.ToString().Substring(2,2))"
    }

    if ($root -in @("GC", "MGC", "SI", "SIL")) {
        $contractMonth = @(2, 4, 6, 8, 10, 12) | Where-Object { $_ -ge $month } | Select-Object -First 1
        if ($null -eq $contractMonth) {
            $contractMonth = 2
            $year++
        }
        return "$root $(([datetime]::new($year, $contractMonth, 1)).ToString('MMM').ToUpperInvariant())$($year.ToString().Substring(2,2))"
    }

    $monthly = $now.AddMonths(1)
    return "$root $($monthly.ToString('MMM').ToUpperInvariant())$($monthly.Year.ToString().Substring(2,2))"
}

function Find-InstrumentFuturesSuggestion($Dialog, $Selector, [string]$InstrumentRoot) {
    $root = Normalize-Name $InstrumentRoot
    if ([string]::IsNullOrWhiteSpace($root)) { return $null }

    $selectorRect = $Selector.Current.BoundingRectangle
    $candidates = New-Object 'System.Collections.Generic.List[object]'
    $roots = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
    $roots.Add($Dialog) | Out-Null
    foreach ($rootWindow in (Get-NinjaTraderRoots)) {
        $roots.Add($rootWindow) | Out-Null
    }

    foreach ($searchRoot in $roots) {
        if ($null -eq $searchRoot) { continue }
        $items = $searchRoot.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)

        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items.Item($i)
            if (-not (Test-ElementVisible $item)) { continue }

            $name = [string]$item.Current.Name
            if ([string]::IsNullOrWhiteSpace($name)) { continue }

            $normalized = Normalize-Name $name
            $hasRoot = $normalized.Contains($root)
            $hasFutures = $normalized.Contains("FUTURES")
            if (-not $hasFutures) { continue }

            $rect = $item.Current.BoundingRectangle
            $distance = 0
            if (-not $selectorRect.IsEmpty -and -not $rect.IsEmpty) {
                $distance = [Math]::Abs($rect.X - $selectorRect.X) + [Math]::Abs($rect.Y - $selectorRect.Y)
                if ($rect.Y -lt $selectorRect.Y) { $distance += 10000 }
            }

            $score = 1000 + $distance
            if ($hasRoot) { $score -= 700 }
            if ($normalized -eq ($root + "FUTURES")) { $score -= 250 }
            if ($normalized -eq "FUTURES") { $score -= 100 }

            $candidates.Add([pscustomobject]@{
                Element = $item
                Score = $score
                Name = $name
            }) | Out-Null
        }
    }

    $best = $candidates | Sort-Object Score, Name | Select-Object -First 1
    if ($null -eq $best) { return $null }
    return $best.Element
}

function Test-DialogStillOpen($Dialog) {
    if ($null -eq $Dialog) { return $false }
    try {
        $handle = $Dialog.Current.NativeWindowHandle
        if ($handle -ne 0) {
            $desktop = [System.Windows.Automation.AutomationElement]::RootElement
            $windows = $desktop.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Window)))
            for ($i = 0; $i -lt $windows.Count; $i++) {
                if ($windows.Item($i).Current.NativeWindowHandle -eq $handle) { return $true }
            }
            return $false
        }
        return -not $Dialog.Current.BoundingRectangle.IsEmpty
    }
    catch {
        return $false
    }
}

function Wait-DialogClosed($Dialog, [int]$Milliseconds = 1800) {
    $deadline = (Get-Date).AddMilliseconds($Milliseconds)
    do {
        if (-not (Test-DialogStillOpen $Dialog)) { return $true }
        Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $deadline)
    return -not (Test-DialogStillOpen $Dialog)
}

function Find-StrategiesOkButton($Dialog) {
    $ok = Find-DescendantByAutomationId $Dialog "btnOk"
    if (Test-ElementVisible $ok) { return $ok }

    $buttons = $Dialog.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.AndCondition]::new(
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Button)),
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "OK")))
    for ($i = 0; $i -lt $buttons.Count; $i++) {
        $button = $buttons.Item($i)
        if (Test-ElementVisible $button) { return $button }
    }

    return Find-DescendantByName $Dialog "OK"
}

function Click-DialogBottomRight($Dialog, [string]$Label) {
    if ($null -eq $Dialog) { throw "$Label dialog not found." }
    $rect = $Dialog.Current.BoundingRectangle
    if ($rect.IsEmpty) { throw "$Label dialog is not visible." }

    $x = [int]($rect.X + $rect.Width - 95)
    $y = [int]($rect.Y + $rect.Height - 28)
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    [Native.WinUi]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Native.WinUi]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Select-ControlCenterStrategiesTab($ControlCenter) {
    Bring-ToForeground $ControlCenter
    $tab = Find-DescendantByAutomationId $ControlCenter "StrategiesGridTabItem"
    Click-ElementCenter $tab "Control Center Strategies tab"
    Start-Sleep -Milliseconds 200
    Select-Element $tab "Control Center Strategies tab"
    Start-Sleep -Milliseconds 500
}

function Open-ControlCenterNewStrategyDialog($ControlCenter) {
    Select-ControlCenterStrategiesTab $ControlCenter

    $grid = Find-DescendantByAutomationId $ControlCenter "StrategiesGrid"
    if ($null -eq $grid) { throw "Control Center Strategies grid not found." }
    if ($grid.Current.BoundingRectangle.IsEmpty) { throw "Control Center Strategies grid is not visible." }

    Bring-ToForeground $ControlCenter
    Start-Sleep -Milliseconds 250
    Click-ElementCenter $grid "Control Center Strategies grid" "right"
    Start-Sleep -Milliseconds 500

    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $newItem = $desktop.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) "New Strategy..."))
    Invoke-Element $newItem "New Strategy menu item"

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        foreach ($root in (Get-NinjaTraderRoots)) {
            $windows = $root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Window)))
            for ($i = 0; $i -lt $windows.Count; $i++) {
                $window = $windows.Item($i)
                if ($window.Current.Name -eq "Strategies" -and (Find-DescendantByAutomationId $window "treeAvailableItems")) {
                    return $window
                }
            }
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)

    throw "Control Center New Strategy dialog did not open."
}

function Get-AvailableStrategyName($Item) {
    $text = $Item.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Text)))
    if ($null -ne $text -and -not [string]::IsNullOrWhiteSpace($text.Current.Name)) {
        return $text.Current.Name
    }
    return $Item.Current.Name
}

function Select-AvailableStrategy($Dialog, [string]$StrategyType) {
    $available = Find-DescendantByAutomationId $Dialog "treeAvailableItems"
    if ($null -eq $available) { $available = Find-DescendantByAutomationId $Dialog "lstBoxAvailableItems" }
    if ($null -eq $available) { throw "Available strategy list not found." }

    $target = Normalize-Name $StrategyType
    $targetKey = Get-StrategyMatchKey $StrategyType
    if ([string]::IsNullOrWhiteSpace($target)) { throw "Strategy type is required before setup." }
    $items = $available.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $propFirm = $null
    $baseExact = $null
    $basePrefix = $null
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items.Item($i)
        $name = Get-AvailableStrategyName $item
        $normalized = Normalize-Name $name
        $candidateKey = Get-StrategyMatchKey $name

        if ($null -eq $propFirm -and
            -not [string]::IsNullOrWhiteSpace($targetKey) -and
            $candidateKey -eq $targetKey -and
            (Test-PropFirmStrategyName $name $StrategyType)) {
            $propFirm = $item
            continue
        }

        if ($null -eq $baseExact -and ($normalized -eq $target -or $candidateKey -eq $targetKey)) {
            $baseExact = $item
            continue
        }

        if ($null -eq $basePrefix -and $target.Length -ge 3 -and
            ($normalized.StartsWith($target) -or
             (-not [string]::IsNullOrWhiteSpace($targetKey) -and $candidateKey.StartsWith($targetKey)))) {
            $basePrefix = $item
        }
    }
    $best = if ($null -ne $propFirm) { $propFirm } elseif ($null -ne $baseExact) { $baseExact } else { $basePrefix }
    if ($null -eq $best) { throw "No NinjaTrader strategy matched '$StrategyType'." }

    $selectedName = Get-AvailableStrategyName $best
    Click-ElementCenter $best "available strategy $StrategyType"
    Start-Sleep -Milliseconds 500
    Select-Element $best "available strategy $StrategyType"
    Start-Sleep -Milliseconds 500

    $results.Add("selected strategy '$selectedName' for requested '$StrategyType'") | Out-Null

    $add = Find-DescendantByName $Dialog "add"
    if (Test-ElementVisible $add) {
        Click-ElementCenter $add "Strategies add button"
        Start-Sleep -Milliseconds 700
    }

    return $selectedName
}

function Set-ComboBoxValue($Combo, [string]$Value, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    if ($null -eq $Combo) { throw "$Label combo box not found." }

    $pattern = $null
    if ($Combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
        $pattern.Expand()
        Start-Sleep -Milliseconds 300
        $items = $Combo.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition)
        $exact = $null
        $partial = $null
        for ($i = 0; $i -lt $items.Count; $i++) {
            $item = $items.Item($i)
            if ($item.Current.Name -eq $Value) {
                $exact = $item
                break
            }
            if ($null -eq $partial -and $item.Current.Name -like "*$Value*") {
                $partial = $item
            }
        }

        $match = if ($null -ne $exact) { $exact } else { $partial }
        if ($null -ne $match) {
            Select-Element $match "$Label $Value"
            Start-Sleep -Milliseconds 200
            return
        }
        $pattern.Collapse()
    }

    $Combo.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    [System.Windows.Forms.SendKeys]::SendWait($Value)
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 200
}

function Set-Account($Dialog, [string]$Account) {
    $combo = Find-DescendantByAutomationId $Dialog "StrategyBasePropertyGridEditorAccount"
    Set-ComboBoxValue $combo $Account "account"
}

function Set-Instrument($Dialog, [string]$Instrument) {
    if ([string]::IsNullOrWhiteSpace($Instrument)) { return }
    $selector = Find-DescendantByAutomationId $Dialog "InstrumentSelector"
    if ($null -eq $selector) { throw "instrument selector not found." }

    $instrumentRoot = Get-InstrumentRoot $Instrument
    if ([string]::IsNullOrWhiteSpace($instrumentRoot)) { throw "instrument root could not be resolved from '$Instrument'." }
    $currentContract = Resolve-CurrentContractName $instrumentRoot

    Try-ScrollIntoView $selector
    Start-Sleep -Milliseconds 400
    $selector = Find-DescendantByAutomationId $Dialog "InstrumentSelector"
    $selectorTextBox = Find-DescendantByAutomationId $selector "textBox"
    if ($null -eq $selectorTextBox) { $selectorTextBox = $selector }

    Set-ElementValue $selectorTextBox $currentContract "instrument selector"
    Start-Sleep -Milliseconds 150
    $focusedInstrument = $false
    try {
        $selectorTextBox.SetFocus()
        $focusedInstrument = $true
    } catch {}
    if (-not $focusedInstrument -and (Test-ElementVisible $selectorTextBox)) {
        Click-ElementCenter $selectorTextBox "instrument selector text box"
        $focusedInstrument = $true
    }
    if (-not $focusedInstrument) {
        try {
            $selector.SetFocus()
            $focusedInstrument = $true
        } catch {}
    }
    if (-not $focusedInstrument -and (Test-ElementVisible $selector)) {
        Click-ElementCenter $selector "instrument selector"
    }
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 700
    $results.Add("selected explicit current contract '$currentContract' for '$instrumentRoot' instrument editor") | Out-Null
    return

    $selector.SetFocus()
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait($instrumentRoot)
    Start-Sleep -Milliseconds 900

    $futuresSuggestion = Find-InstrumentFuturesSuggestion $Dialog $selector $instrumentRoot
    if ($null -eq $futuresSuggestion) {
        $currentContract = Resolve-CurrentContractName $instrumentRoot
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.SendKeys]::SendWait($currentContract)
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Milliseconds 700
        $results.Add("selected explicit current contract '$currentContract' for '$instrumentRoot' instrument fallback") | Out-Null
        return
    }

    Click-ElementCenter $futuresSuggestion "instrument futures suggestion $instrumentRoot"
    Start-Sleep -Milliseconds 700
    $results.Add("selected current futures contract from '$instrumentRoot' instrument suggestion") | Out-Null
}

function Try-ScrollIntoView($Element) {
    if ($null -eq $Element) { return }
    $pattern = $null
    try {
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$pattern)) {
            $pattern.ScrollIntoView()
            Start-Sleep -Milliseconds 250
        }
    } catch {}
}

function Write-ElementDebugTree($Element, [string]$Path, [int]$MaxDepth = 8) {
    if ($null -eq $Element) { return }
    try {
        $dir = Split-Path -Parent $Path
        if (-not [string]::IsNullOrWhiteSpace($dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        $lines = New-Object 'System.Collections.Generic.List[string]'
        function Add-ElementLine($Node, [int]$Depth) {
            if ($null -eq $Node -or $Depth -gt $MaxDepth) { return }
            $current = $Node.Current
            $rect = $current.BoundingRectangle
            $rectText = if ($rect.IsEmpty) { "empty" } else { "{0},{1},{2},{3}" -f [int]$rect.X,[int]$rect.Y,[int]$rect.Width,[int]$rect.Height }
            $lines.Add((("  " * $Depth) + "{0} | name='{1}' | aid='{2}' | class='{3}' | enabled={4} | rect={5}" -f
                $current.ControlType.ProgrammaticName,
                (($current.Name -replace "\r?\n", " ").Trim()),
                $current.AutomationId,
                $current.ClassName,
                $current.IsEnabled,
                $rectText)) | Out-Null
            $children = $Node.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
            for ($i = 0; $i -lt $children.Count; $i++) {
                Add-ElementLine $children.Item($i) ($Depth + 1)
            }
        }
        $lines.Add("Debug tree $(Get-Date -Format s)") | Out-Null
        Add-ElementLine $Element 0
        Set-Content -Path $Path -Value $lines -Encoding UTF8
    } catch {}
}

function Show-TemplateSlideout($Dialog) {
    $slideout = $Dialog.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.AndCondition]::new(
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "presetSlideout"),
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty) "StrategyTemplateSlideout")))
    if ($null -eq $slideout) { return $null }

    Try-ScrollIntoView $slideout
    if (Test-ElementVisible $slideout) { return $slideout }

    $properties = Find-DescendantByName $Dialog "Properties"
    if (Test-ElementVisible $properties) {
        try { $properties.SetFocus() } catch {}
        Click-ElementCenter $properties "Properties panel"
        Start-Sleep -Milliseconds 150
        [System.Windows.Forms.SendKeys]::SendWait("^{END}")
        Start-Sleep -Milliseconds 250
        [System.Windows.Forms.SendKeys]::SendWait("{END}")
        Start-Sleep -Milliseconds 250
    } else {
        Bring-ToForeground $Dialog
        [System.Windows.Forms.SendKeys]::SendWait("^{END}")
        Start-Sleep -Milliseconds 250
    }

    $slideout = $Dialog.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.AndCondition]::new(
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "presetSlideout"),
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty) "StrategyTemplateSlideout")))
    return $slideout
}

function Resolve-TemplatePath([string]$StrategyType, [string]$TemplateName) {
    if ([IO.Path]::IsPathRooted($TemplateName) -and (Test-Path $TemplateName)) { return $TemplateName }

    $templatesRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "NinjaTrader 8\templates\Strategy"
    if (-not (Test-Path $templatesRoot)) { return "" }

    $strategyKey = Normalize-Name $StrategyType
    $dirs = Get-ChildItem -Path $templatesRoot -Directory -ErrorAction SilentlyContinue
    $matchingDirs = $dirs | Where-Object {
        $key = Normalize-Name $_.Name
        $key -eq $strategyKey -or $key.StartsWith($strategyKey) -or $strategyKey.StartsWith($key)
    }
    if ($matchingDirs.Count -eq 0) { $matchingDirs = $dirs }

    if ([string]::IsNullOrWhiteSpace($TemplateName)) { return "" }
    foreach ($dir in $matchingDirs) {
        $exact = Join-Path $dir.FullName ($TemplateName + ".xml")
        if (Test-Path $exact) { return $exact }
        $loose = Get-ChildItem -Path $dir.FullName -Filter "*.xml" -ErrorAction SilentlyContinue |
            Where-Object { (Normalize-Name $_.BaseName) -eq (Normalize-Name $TemplateName) } |
            Select-Object -First 1
        if ($null -ne $loose) { return $loose.FullName }
    }
    return ""
}

function Resolve-DefaultTemplatePath([string]$StrategyType, [string]$TradingPeriod) {
    $templatesRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "NinjaTrader 8\templates\Strategy"
    if (-not (Test-Path $templatesRoot)) { return "" }

    $strategyKey = Normalize-Name $StrategyType
    if ([string]::IsNullOrWhiteSpace($strategyKey)) { return "" }
    $templatePeriod = if ($TradingPeriod -match "2") { "Period 1" } else { "Period 0" }
    $dirs = Get-ChildItem -Path $templatesRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            $key = Normalize-Name $_.Name
            $key -eq $strategyKey -or $key.StartsWith($strategyKey) -or $strategyKey.StartsWith($key)
        }

    foreach ($dir in $dirs) {
        $match = Get-ChildItem -Path $dir.FullName -Filter "*.xml" -ErrorAction SilentlyContinue |
            Where-Object {
                $base = $_.BaseName
                (Normalize-Name $base).Contains("LOWRISK") -and
                $base -match "\bv\s*1\b" -and
                (Normalize-Name $base).Contains((Normalize-Name $templatePeriod))
            } |
            Sort-Object @{ Expression = { if ((Normalize-Name $_.BaseName).Contains($strategyKey)) { 0 } else { 1 } } }, Length |
            Select-Object -First 1
        if ($null -ne $match) { return $match.FullName }
    }

    return ""
}

function Load-Template($Dialog, [string]$StrategyType, [string]$TemplateName, [string]$TradingPeriod) {
    $path = Resolve-TemplatePath $StrategyType $TemplateName
    if ([string]::IsNullOrWhiteSpace($path)) {
        $path = Resolve-DefaultTemplatePath $StrategyType $TradingPeriod
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            $results.Add("defaulted template to $([IO.Path]::GetFileNameWithoutExtension($path))") | Out-Null
        }
    }
    if ([string]::IsNullOrWhiteSpace($path)) {
        $results.Add("template not found for $StrategyType / $TemplateName; defaults used") | Out-Null
        return
    }

    $templateSlideout = Show-TemplateSlideout $Dialog
    if ($null -eq $templateSlideout) { throw "Strategy template slideout not found." }
    $templateHeader = Find-DescendantByAutomationId $templateSlideout "HeaderSite"
    if ($null -eq $templateHeader) { $templateHeader = Find-DescendantByName $templateSlideout "template" }
    $load = $null
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $templateSlideout = Show-TemplateSlideout $Dialog
        if ($null -eq $templateSlideout) { throw "Strategy template slideout not found after expand." }
        $load = Find-VisibleDescendantByName $templateSlideout "load"
        if (Test-ElementVisible $load) { break }
        if (-not (Test-ElementVisible $templateHeader)) {
            $templateHeader = Find-DescendantByAutomationId $templateSlideout "HeaderSite"
        }
        if (Test-ElementVisible $templateHeader) {
            Click-ElementCenter $templateHeader "template slideout"
        } elseif (Test-ElementVisible $templateSlideout) {
            Click-ElementCenter $templateSlideout "template slideout"
        } else {
            Bring-ToForeground $Dialog
            [System.Windows.Forms.SendKeys]::SendWait(" ")
        }
        Start-Sleep -Milliseconds 450
    }
    if ($null -eq $load) {
        $debugPath = Join-Path $env:TEMP "vincere-template-slideout-debug.txt"
        Write-ElementDebugTree $templateSlideout $debugPath
        throw "Template load button not found. Debug: $debugPath"
    }
    if (-not (Test-ElementVisible $load)) {
        $results.Add("template load button is offscreen; invoking through UI Automation") | Out-Null
    }

    Invoke-OrClickElement $load "template load button"
    Start-Sleep -Milliseconds 700

    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $templateWindow = $null
    $deadline = (Get-Date).AddSeconds(8)
    do {
        $windows = $desktop.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Window)))
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $window = $windows.Item($i)
            if ($window.Current.Name -match "Load.*strategy template|strategy template|Open|Load") {
                $templateWindow = $window
                break
            }
        }
        if ($null -ne $templateWindow) { break }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if ($null -eq $templateWindow) { throw "Template load window did not open." }

    $templateBaseName = [IO.Path]::GetFileNameWithoutExtension($path)
    if ($templateWindow.Current.Name -match "Open") {
        $edits = $templateWindow.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Edit))
        )
        if ($edits.Count -lt 1) { throw "Template file name box not found." }
        Set-ElementValue $edits.Item(0) $path "template file name"
        Start-Sleep -Milliseconds 200
        $openButton = Find-DescendantByName $templateWindow "Open"
        if ($null -eq $openButton) { $openButton = Find-DescendantByName $templateWindow "OK" }
        Invoke-OrClickElement $openButton "template open button"
    } else {
        $target = Normalize-Name $templateBaseName
        $matches = $templateWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $templateItem = $null
        for ($i = 0; $i -lt $matches.Count; $i++) {
            $item = $matches.Item($i)
            $name = $item.Current.Name
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            if ((Normalize-Name $name) -eq $target) {
                $templateItem = $item
                break
            }
        }
        if ($null -eq $templateItem) { throw "Template '$templateBaseName' not found in NinjaTrader template picker." }
        Click-ElementCenter $templateItem "template '$templateBaseName'"
        Start-Sleep -Milliseconds 250
        $loadButton = Find-VisibleDescendantByName $templateWindow "Load"
        if ($null -eq $loadButton) { $loadButton = Find-VisibleDescendantByName $templateWindow "OK" }
        Invoke-OrClickElement $loadButton "template picker load button"
    }
    Start-Sleep -Milliseconds 800
    $results.Add("loaded template $([IO.Path]::GetFileNameWithoutExtension($path))") | Out-Null
}

function Set-LicenseKey($Dialog, [string]$LicenseKey) {
    if ([string]::IsNullOrWhiteSpace($LicenseKey)) { throw "Verified license key is required before strategy setup." }

    $edits = $Dialog.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Edit)))
    for ($i = 0; $i -lt $edits.Count; $i++) {
        $edit = $edits.Item($i)
        if ($edit.Current.AutomationId -like "*PropertyGridEditorLicenseKey" -or $edit.Current.AutomationId -like "*LicenseKey*") {
            Set-ElementValue $edit $LicenseKey "strategy license key"
            return
        }
    }

    throw "Strategy license key editor not found."
}

function Ensure-EnabledUnchecked($Dialog) {
    $checkbox = Find-DescendantByAutomationId $Dialog "StrategyRenderBasePropertyGridEditorIsEnabled"
    if ($null -eq $checkbox) { return }
    $pattern = $null
    if ($checkbox.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        if ($pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
            $pattern.Toggle()
        }
    }
}

function Confirm-StrategiesDialog($Dialog) {
    Bring-ToForeground $Dialog
    Start-Sleep -Milliseconds 250
    $ok = Find-StrategiesOkButton $Dialog

    # NinjaTrader's strategy ObjectDialog can throw when OK is invoked through
    # UI Automation's ButtonAutomationPeer. A real click follows the same path
    # a user takes and avoids the DialogResult automation exception.
    if ((Test-ElementEnabled $ok) -and (Test-ElementVisible $ok)) {
        Click-ElementCenter $ok "Strategies OK button"
        if (Wait-DialogClosed $Dialog) {
            $results.Add("confirmed strategy dialog with OK click") | Out-Null
            return
        }
    }

    try {
        if (Test-ElementEnabled $ok) {
            $ok.SetFocus()
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait(" ")
        }
    } catch {}
    if (Wait-DialogClosed $Dialog) {
        $results.Add("confirmed strategy dialog with OK focus/space") | Out-Null
        return
    }

    Bring-ToForeground $Dialog
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    if (Wait-DialogClosed $Dialog) {
        $results.Add("confirmed strategy dialog with Enter") | Out-Null
        return
    }

    Click-DialogBottomRight $Dialog "Strategies"
    if (Wait-DialogClosed $Dialog) {
        $results.Add("confirmed strategy dialog with bottom-right click") | Out-Null
        return
    }

    throw "Strategies OK click did not close the dialog."
}

function Cancel-StrategiesDialog($Dialog) {
    $cancel = Find-DescendantByName $Dialog "Cancel"
    if (Test-ElementVisible $cancel) {
        Click-ElementCenter $cancel "Strategies Cancel button"
        Start-Sleep -Milliseconds 500
        return
    }

    $pattern = $null
    if ($null -ne $Dialog -and $Dialog.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) {
        try {
            $pattern.Close()
            Start-Sleep -Milliseconds 500
            return
        } catch {}
    }

    Bring-ToForeground $Dialog
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Start-Sleep -Milliseconds 500
}

$strategies = @($payload.strategies)
if ($strategies.Count -eq 0) { throw "No strategies were supplied." }

$controlCenter = Wait-ControlCenter
if ($null -eq $controlCenter) { throw "NinjaTrader Control Center not found." }
Close-BlockingNinjaTraderWindows
$controlCenter = Wait-ControlCenter
if ($null -eq $controlCenter) { throw "NinjaTrader Control Center not found after cleanup." }
$licenseKey = [string]$payload.licenseKey
if ([string]::IsNullOrWhiteSpace($licenseKey)) { throw "Verified license key missing from setup payload." }

foreach ($strategy in $strategies) {
    $controlCenter = Wait-ControlCenter
    if ($null -eq $controlCenter) { throw "NinjaTrader Control Center not found before strategy setup." }
    $dialog = Open-ControlCenterNewStrategyDialog $controlCenter
    try {
        $strategyType = [string]$strategy.strategyType
        $strategyAccount = Resolve-SetupAccount ([string]$strategy.account) ([string]$payload.account)
        if ($strategyAccount -ne [string]$strategy.account) {
            $results.Add("resolved setup account '$($strategy.account)' to '$strategyAccount'") | Out-Null
        }
        Select-AvailableStrategy $dialog $strategyType | Out-Null
        Load-Template $dialog $strategyType ([string]$strategy.template) ([string]$strategy.tradingPeriod)
        Set-LicenseKey $dialog $licenseKey
        Set-Account $dialog $strategyAccount
        $resolvedInstrument = Resolve-InstrumentForStrategy $strategyType ([string]$strategy.instrument)
        if ($resolvedInstrument -ne [string]$strategy.instrument) {
            $results.Add("resolved instrument '$($strategy.instrument)' to '$resolvedInstrument' for $strategyType") | Out-Null
        }
        Set-Instrument $dialog $resolvedInstrument
        Ensure-EnabledUnchecked $dialog

        if ($WhatIf) {
            Cancel-StrategiesDialog $dialog
            $results.Add("WHATIF configured $($strategy.strategyType) $resolvedInstrument from Control Center") | Out-Null
        } else {
            Confirm-StrategiesDialog $dialog
            $results.Add("configured $($strategy.strategyType) $resolvedInstrument from Control Center") | Out-Null
        }
        Start-Sleep -Milliseconds 700
    }
    catch {
        try { Cancel-StrategiesDialog $dialog } catch {}
        throw
    }
}

$results | ForEach-Object { Write-Host $_ }
