<#
.SYNOPSIS
    Production-readiness UI test and screenshot report for Vincere Ninja Manager.

.DESCRIPTION
    Runs in an interactive Windows/RDP desktop session. The script behaves like a
    careful human QA pass: it opens or attaches to the manager, navigates the main
    screens, verifies expected controls and status text, optionally invokes gated
    live actions, captures screenshots, and writes a Markdown report showing
    expected vs actual results.

    Default mode is non-destructive. Actions that can change live NinjaTrader
    state, create strategy rows, connect/disconnect prop firms, or import/overwrite
    stack data are skipped unless their explicit switch is passed.

.PARAMETER AppPath
    Path to Vincere.Operator.exe.

.PARAMETER BlueprintPath
    Optional blueprint file to use when -IncludeBlueprintImport is enabled.

.PARAMETER IncludeManagerStartStop
    Click Start Manager and Stop Manager.

.PARAMETER IncludeNinjaTraderLaunchShutdown
    Click Start NinjaTrader and Stop NinjaTrader.

.PARAMETER IncludeLiveConnectionActions
    Click Connect All and Disconnect All.

.PARAMETER IncludeLiveEnableDisable
    Click Enable Strategies and Disable Strategies.

.PARAMETER IncludeBlueprintImport
    Use BlueprintPath in the file picker and click Save Account Setup.

.PARAMETER IncludeLiveAddAll
    Click Add All to NinjaTrader and confirm. This can create duplicate strategy
    rows if the grid is not clean.

.PARAMETER CloseWhenDone
    Close the manager if this script launched it.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\Test-VincereProductionReadiness.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\Test-VincereProductionReadiness.ps1 `
      -BlueprintPath "C:\Users\Administrator\Desktop\Vincere_Blueprint_2026-05-25.xlsx" `
      -IncludeBlueprintImport

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\Test-VincereProductionReadiness.ps1 `
      -IncludeLiveConnectionActions -IncludeLiveEnableDisable
#>
param(
    [string]$AppPath = "$env:LOCALAPPDATA\Programs\VincereOps\Vincere.Operator.exe",
    [string]$BlueprintPath = "",
    [string]$OutputRoot = "",
    [int]$TimeoutSeconds = 30,
    [switch]$IncludeManagerStartStop,
    [switch]$IncludeNinjaTraderLaunchShutdown,
    [switch]$IncludeLiveConnectionActions,
    [switch]$IncludeLiveEnableDisable,
    [switch]$IncludeBlueprintImport,
    [switch]$IncludeLiveAddAll,
    [switch]$CloseWhenDone
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("Native.VincereQaWin32" -as [type])) {
    $sig = @'
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@
    Add-Type -MemberDefinition $sig -Name VincereQaWin32 -Namespace Native
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot ("logs\production-readiness\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$screensDir = Join-Path $OutputRoot "screenshots"
$reportPath = Join-Path $OutputRoot "PRODUCTION_READINESS_REPORT.md"
$jsonPath = Join-Path $OutputRoot "results.json"
New-Item -ItemType Directory -Force -Path $screensDir | Out-Null

$script:Results = New-Object 'System.Collections.Generic.List[object]'
$script:ScreenshotIndex = 0
$script:LaunchedProcess = $false

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function New-ControlTypeCondition([System.Windows.Automation.ControlType]$ControlType) {
    New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) $ControlType
}

function New-NameCondition([string]$Name) {
    New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $Name
}

function Find-ByName($Root, [string]$Name) {
    if ($null -eq $Root) { return $null }
    $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-NameCondition $Name))
}

function Find-ByNameAndType($Root, [string]$Name, [System.Windows.Automation.ControlType]$Type) {
    if ($null -eq $Root) { return $null }
    $condition = [System.Windows.Automation.AndCondition]::new((New-NameCondition $Name), (New-ControlTypeCondition $Type))
    $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Test-Visible($Element) {
    if ($null -eq $Element) { return $false }
    try { return -not $Element.Current.BoundingRectangle.IsEmpty } catch { return $false }
}

function Bring-ToFront($Element) {
    if ($null -eq $Element) { return }
    try {
        $handle = $Element.Current.NativeWindowHandle
        if ($handle -ne 0) {
            [Native.VincereQaWin32]::ShowWindow([IntPtr]$handle, 9) | Out-Null
            Start-Sleep -Milliseconds 100
            [Native.VincereQaWin32]::SetForegroundWindow([IntPtr]$handle) | Out-Null
            Start-Sleep -Milliseconds 250
        }
        $Element.SetFocus()
    } catch {}
}

function Take-Screenshot([string]$Slug) {
    try {
        $script:ScreenshotIndex++
        $safeSlug = ($Slug -replace "[^A-Za-z0-9._-]", "-").Trim("-")
        if ([string]::IsNullOrWhiteSpace($safeSlug)) { $safeSlug = "step" }
        $fileName = "{0:D2}-{1}.png" -f $script:ScreenshotIndex, $safeSlug
        $path = Join-Path $screensDir $fileName
        $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
            $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
        return $path
    }
    catch {
        return ""
    }
}

function Add-Result {
    param(
        [string]$Area,
        [string]$Check,
        [string]$Expected,
        [ValidateSet("PASS", "FAIL", "SKIP", "WARN")]
        [string]$Status,
        [string]$Actual,
        [string]$Screenshot = ""
    )

    $item = [pscustomobject]@{
        Time = (Get-Date).ToString("s")
        Area = $Area
        Check = $Check
        Expected = $Expected
        Status = $Status
        Actual = $Actual
        Screenshot = $Screenshot
    }
    $script:Results.Add($item) | Out-Null

    $color = "White"
    if ($Status -eq "PASS") { $color = "Green" }
    elseif ($Status -eq "FAIL") { $color = "Red" }
    elseif ($Status -eq "SKIP") { $color = "Yellow" }
    elseif ($Status -eq "WARN") { $color = "DarkYellow" }
    Write-Host ("[{0}] {1} / {2}: {3}" -f $Status, $Area, $Check, $Actual) -ForegroundColor $color
}

function Get-UiText($Root) {
    if ($null -eq $Root) { return "" }
    $items = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $names = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $items.Count; $i++) {
        $name = $items.Item($i).Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name)) { $names.Add($name.Trim()) | Out-Null }
    }
    ($names | Select-Object -Unique) -join "`n"
}

function Assert-Text {
    param($Root, [string]$Area, [string]$Check, [string]$Pattern, [string]$Expected, [string]$Slug)
    $text = Get-UiText $Root
    $shot = Take-Screenshot $Slug
    if ($text -match $Pattern) {
        Add-Result $Area $Check $Expected "PASS" "Matched /$Pattern/." $shot
    } else {
        Add-Result $Area $Check $Expected "FAIL" "Did not match /$Pattern/." $shot
    }
}

function Assert-Control {
    param($Root, [string]$Area, [string]$Name, [string]$Expected = "Control should be visible or discoverable by UI Automation.")
    $element = Find-ByName $Root $Name
    $shot = Take-Screenshot ("control-" + $Name)
    if ($null -ne $element) {
        $visibleText = if (Test-Visible $element) { "visible" } else { "present but offscreen/collapsed" }
        Add-Result $Area "Control: $Name" $Expected "PASS" "Found ($visibleText)." $shot
        return $true
    }
    Add-Result $Area "Control: $Name" $Expected "FAIL" "Not found." $shot
    return $false
}

function Invoke-Control {
    param(
        $Root,
        [string]$Area,
        [string]$Name,
        [string]$Expected,
        [ValidateSet("Safe", "Manager", "LiveConnection", "LiveEnable", "LiveAddAll", "BlueprintImport", "NinjaTraderProcess")]
        [string]$Risk = "Safe",
        [int]$WaitSeconds = 1
    )

    $allowed = $true
    $why = ""
    switch ($Risk) {
        "Manager" { $allowed = $IncludeManagerStartStop; $why = "requires -IncludeManagerStartStop" }
        "LiveConnection" { $allowed = $IncludeLiveConnectionActions; $why = "requires -IncludeLiveConnectionActions" }
        "LiveEnable" { $allowed = $IncludeLiveEnableDisable; $why = "requires -IncludeLiveEnableDisable" }
        "LiveAddAll" { $allowed = $IncludeLiveAddAll; $why = "requires -IncludeLiveAddAll; can create duplicate strategy rows" }
        "BlueprintImport" { $allowed = $IncludeBlueprintImport; $why = "requires -IncludeBlueprintImport; can persist stack/account data" }
        "NinjaTraderProcess" { $allowed = $IncludeNinjaTraderLaunchShutdown; $why = "requires -IncludeNinjaTraderLaunchShutdown" }
    }

    if (-not $allowed) {
        Add-Result $Area "Invoke: $Name" $Expected "SKIP" "Skipped because $why." (Take-Screenshot ("skip-" + $Name))
        return $false
    }

    $element = Find-ByNameAndType $Root $Name ([System.Windows.Automation.ControlType]::Button)
    if ($null -eq $element) { $element = Find-ByName $Root $Name }
    if ($null -eq $element) {
        Add-Result $Area "Invoke: $Name" $Expected "FAIL" "Control not found." (Take-Screenshot ("missing-" + $Name))
        return $false
    }
    if (-not $element.Current.IsEnabled) {
        Add-Result $Area "Invoke: $Name" $Expected "SKIP" "Control is disabled." (Take-Screenshot ("disabled-" + $Name))
        return $false
    }

    $pattern = $null
    try {
        if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
        } else {
            $element.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait(" ")
        }
        Start-Sleep -Seconds $WaitSeconds
        Add-Result $Area "Invoke: $Name" $Expected "PASS" "Invoked." (Take-Screenshot ("after-" + $Name))
        return $true
    }
    catch {
        Add-Result $Area "Invoke: $Name" $Expected "FAIL" $_.Exception.Message (Take-Screenshot ("failed-" + $Name))
        return $false
    }
}

function Select-Tab {
    param($Root, [string]$Name)
    $tab = Find-ByNameAndType $Root $Name ([System.Windows.Automation.ControlType]::TabItem)
    if ($null -eq $tab) { $tab = Find-ByName $Root $Name }
    if ($null -eq $tab) {
        Add-Result "Navigation" "Tab: $Name" "Tab should exist." "FAIL" "Tab not found." (Take-Screenshot ("tab-missing-" + $Name))
        return $false
    }
    try {
        $pattern = $null
        if ($tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
            $pattern.Select()
        } elseif ($tab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
        } else {
            $tab.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait(" ")
        }
        Start-Sleep -Milliseconds 500
        Add-Result "Navigation" "Tab: $Name" "Tab should select successfully." "PASS" "Selected." (Take-Screenshot ("tab-" + $Name))
        return $true
    }
    catch {
        Add-Result "Navigation" "Tab: $Name" "Tab should select successfully." "FAIL" $_.Exception.Message (Take-Screenshot ("tab-failed-" + $Name))
        return $false
    }
}

function Find-ManagerWindow([int]$TargetProcessId) {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $TargetProcessId
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $w = $windows.Item($i)
        if ($w.Current.Name -like "*Vincere*" -or $w.Current.Name -like "*Ninja Manager*") { return $w }
    }
    if ($windows.Count -gt 0) { return $windows.Item(0) }
    return $null
}

function Wait-ManagerWindow([System.Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $window = Find-ManagerWindow $Process.Id
        if ($null -ne $window) { return $window }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $null
}

function Dismiss-KnownDialogs {
    for ($i = 0; $i -lt 3; $i++) {
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
        Start-Sleep -Milliseconds 200
    }
}

function Get-NinjaTraderControlCenter {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
        $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
        $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        for ($i = 0; $i -lt $windows.Count; $i++) {
            $w = $windows.Item($i)
            $name = $w.Current.Name
            $className = $w.Current.ClassName
            $automationId = $w.Current.AutomationId
            $hasControlCenterControls = $null -ne $w.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                ([System.Windows.Automation.OrCondition]::new(
                    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGridTabItem"),
                    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGrid"))))
            if ($automationId -eq "ControlCenter" -or $className -eq "ControlCenter" -or $name -like "*Control Center*" -or $hasControlCenterControls) { return $w }
        }
    }
    return $null
}

function Select-NinjaTraderStrategiesTab($ControlCenter) {
    $tab = $ControlCenter.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGridTabItem"))
    if ($null -eq $tab) { return $false }

    $pattern = $null
    if ($tab.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
        Start-Sleep -Milliseconds 300
        return $true
    }
    if ($tab.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        Start-Sleep -Milliseconds 300
        return $true
    }
    try {
        $tab.SetFocus()
        [System.Windows.Forms.SendKeys]::SendWait(" ")
        Start-Sleep -Milliseconds 300
        return $true
    } catch {
        return $false
    }
}

function Quote-ProcessArgument([string]$Value) {
    if ($null -eq $Value) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-ScriptFileCheck {
    param(
        [string]$Area,
        [string]$Check,
        [string]$Expected,
        [string]$ScriptPath,
        [string[]]$Arguments = @()
    )
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "powershell.exe"
        $parts = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Quote-ProcessArgument $ScriptPath))
        foreach ($arg in $Arguments) { $parts += (Quote-ProcessArgument $arg) }
        $psi.Arguments = $parts -join " "
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $stdout = $p.StandardOutput.ReadToEnd()
        $stderr = $p.StandardError.ReadToEnd()
        $p.WaitForExit(30000) | Out-Null
        $actual = (($stdout + "`n" + $stderr).Trim() -replace "\r?\n", " | ")
        if ($p.ExitCode -eq 0) {
            Add-Result $Area $Check $Expected "PASS" $actual (Take-Screenshot ("script-" + $Check))
        } else {
            Add-Result $Area $Check $Expected "FAIL" "Exit $($p.ExitCode): $actual" (Take-Screenshot ("script-fail-" + $Check))
        }
    }
    catch {
        Add-Result $Area $Check $Expected "FAIL" $_.Exception.Message (Take-Screenshot ("script-exception-" + $Check))
    }
}

Write-Host "Vincere production-readiness QA"
Write-Host "Report folder: $OutputRoot"
Write-Host ""

try {
    Add-Result "Environment" "Interactive desktop" "Script must run in an unlocked RDP/desktop session." "WARN" "PowerShell cannot prove the desktop is unlocked; screenshots will confirm." (Take-Screenshot "environment")

    if (Test-Path $AppPath) {
        Add-Result "Environment" "Application path" "Vincere.Operator.exe should exist." "PASS" $AppPath ""
    } else {
        Add-Result "Environment" "Application path" "Vincere.Operator.exe should exist." "FAIL" "Not found: $AppPath" ""
        throw "Application path missing."
    }

    $process = Get-Process -Name "Vincere.Operator" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $process) {
        $process = Start-Process -FilePath $AppPath -PassThru
        $script:LaunchedProcess = $true
        Add-Result "Application" "Launch manager" "Manager should launch." "PASS" "Started PID $($process.Id)." (Take-Screenshot "manager-launched")
    } else {
        Add-Result "Application" "Attach manager" "Manager should be running or launchable." "PASS" "Attached PID $($process.Id)." (Take-Screenshot "manager-attached")
    }

    $root = Wait-ManagerWindow $process
    if ($null -eq $root) {
        Add-Result "Application" "Main window" "Main window should be visible to UI Automation." "FAIL" "No manager window found." (Take-Screenshot "manager-window-missing")
        throw "Manager window missing."
    }
    Bring-ToFront $root
    Dismiss-KnownDialogs
    Add-Result "Application" "Main window" "Window should be visible." "PASS" $root.Current.Name (Take-Screenshot "manager-main-window")

    if (Select-Tab $root "Dashboard") {
        Assert-Control $root "Dashboard" "Vincere Trading Ninja Manager" "Brand title should be visible."
        Assert-Control $root "Dashboard" "NinjaTrader: Managed" "NinjaTrader status should be visible."
        Assert-Control $root "Dashboard" "Start Manager"
        Assert-Control $root "Dashboard" "Stop Manager"
        Assert-Control $root "Dashboard" "Start NinjaTrader"
        Assert-Control $root "Dashboard" "Stop NinjaTrader"
        Assert-Control $root "Dashboard" "Enable Strategies"
        Assert-Control $root "Dashboard" "Disable Strategies"
        Assert-Control $root "Dashboard" "Connect All"
        Assert-Control $root "Dashboard" "Disconnect All"
        Assert-Control $root "Dashboard" "View Logs"

        Invoke-Control $root "Dashboard" "Start Manager" "Manager should arm scheduled automation." "Manager" 1
        Invoke-Control $root "Dashboard" "Stop Manager" "Manager should stop scheduled automation." "Manager" 1
        Invoke-Control $root "Dashboard" "Start NinjaTrader" "NinjaTrader launch should be requested." "NinjaTraderProcess" 3
        Invoke-Control $root "Dashboard" "Stop NinjaTrader" "NinjaTrader shutdown should be requested." "NinjaTraderProcess" 3
        Invoke-Control $root "Dashboard" "Connect All" "Configured prop firm connections should connect." "LiveConnection" 5
        Invoke-Control $root "Dashboard" "Disconnect All" "Configured prop firm connections should disconnect." "LiveConnection" 5
        Invoke-Control $root "Dashboard" "Enable Strategies" "Visible strategies should become enabled." "LiveEnable" 5
        Invoke-Control $root "Dashboard" "Disable Strategies" "Visible strategies should become disabled." "LiveEnable" 5
    }

    if (Select-Tab $root "Settings") {
        Assert-Control $root "Settings" "Prop Firm Setup"
        Assert-Control $root "Settings" "Scan NinjaTrader"
        Assert-Control $root "Settings" "Save All Settings"
        Invoke-Control $root "Settings" "Scan NinjaTrader" "Scan should discover connections and accounts when NinjaTrader is open." "Safe" 8
        Assert-Text $root "Settings" "Scan result text" "Found [0-9]+ connection\(s\) and [0-9]+ account\(s\)" "Scan should report discovered connection/account counts." "settings-scan-result"
    }

    if (Select-Tab $root "Accounts") {
        Assert-Control $root "Accounts" "Accounts"
        Assert-Control $root "Accounts" "PnL"
        Assert-Control $root "Accounts" "Trades"
        Assert-Text $root "Accounts" "Account data visible" "APEX|LFE|LTD|Sim" "At least one known account should appear." "accounts-data"
    }

    if (Select-Tab $root "Edit Stack") {
        Assert-Control $root "Edit Stack" "Select account"
        Assert-Control $root "Edit Stack" "Refresh Templates"
        Assert-Control $root "Edit Stack" "Add All to NinjaTrader"
        Invoke-Control $root "Edit Stack" "Refresh Templates" "Template list should refresh without error." "Safe" 2
        Invoke-Control $root "Edit Stack" "Add All to NinjaTrader" "All checked stack rows should be applied to NinjaTrader." "LiveAddAll" 3
    }

    if (Select-Tab $root "Blueprint Import") {
        Assert-Control $root "Blueprint Import" "Choose Blueprint .xlsx"
        Assert-Control $root "Blueprint Import" "Save Account Setup"
        if ($IncludeBlueprintImport) {
            if ([string]::IsNullOrWhiteSpace($BlueprintPath) -or -not (Test-Path $BlueprintPath)) {
                Add-Result "Blueprint Import" "BlueprintPath" "A valid blueprint path is required for import testing." "FAIL" "BlueprintPath missing or not found: $BlueprintPath" (Take-Screenshot "blueprint-path-missing")
            } else {
                $clicked = Invoke-Control $root "Blueprint Import" "Choose Blueprint .xlsx" "File picker should open." "BlueprintImport" 1
                if ($clicked) {
                    [System.Windows.Forms.SendKeys]::SendWait($BlueprintPath)
                    Start-Sleep -Milliseconds 300
                    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                    Start-Sleep -Seconds 3
                    Add-Result "Blueprint Import" "Choose file" "Blueprint should parse." "PASS" "Submitted $BlueprintPath." (Take-Screenshot "blueprint-file-submitted")
                }
                Invoke-Control $root "Blueprint Import" "Save Account Setup" "Imported rows should map into saved stack setup." "BlueprintImport" 3
            }
        } else {
            Add-Result "Blueprint Import" "Save Account Setup" "Blueprint import should work with a supplied file." "SKIP" "Skipped because -IncludeBlueprintImport was not supplied." (Take-Screenshot "blueprint-import-skipped")
        }
    }

    $nt = Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $nt) {
        Add-Result "NinjaTrader" "Process" "NinjaTrader should be running for live verification." "WARN" "NinjaTrader process not found." (Take-Screenshot "ninjatrader-not-running")
    } else {
        Add-Result "NinjaTrader" "Process" "NinjaTrader should be running for live verification." "PASS" "PID $($nt.Id)." (Take-Screenshot "ninjatrader-process")
        $cc = Get-NinjaTraderControlCenter
        if ($null -eq $cc) {
            Add-Result "NinjaTrader" "Control Center" "Control Center should be visible to UI Automation." "FAIL" "Control Center not found." (Take-Screenshot "control-center-missing")
        } else {
            Bring-ToFront $cc
            Add-Result "NinjaTrader" "Control Center" "Control Center should be visible to UI Automation." "PASS" $cc.Current.Name (Take-Screenshot "control-center")
            Select-NinjaTraderStrategiesTab $cc | Out-Null
            $grid = $cc.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "StrategiesGrid"))
            if ($null -eq $grid) {
                Add-Result "NinjaTrader" "Strategies grid" "Strategies grid should be found." "FAIL" "StrategiesGrid not found." (Take-Screenshot "strategies-grid-missing")
            } else {
                $rows = $grid.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-ControlTypeCondition ([System.Windows.Automation.ControlType]::DataItem)))
                Add-Result "NinjaTrader" "Strategies grid" "Strategies grid should be found." "PASS" "Found grid; UIA data item count: $($rows.Count)." (Take-Screenshot "strategies-grid")
            }
        }

        $enableScript = Join-Path $PSScriptRoot "Set-NinjaTraderStrategiesEnabled.ps1"
        if (Test-Path $enableScript) {
            Invoke-ScriptFileCheck "NinjaTrader" "Enable strategies what-if" "What-if should report visible strategy checkbox count without changing state." $enableScript @("-Enabled", "true", "-WhatIf")
            Invoke-ScriptFileCheck "NinjaTrader" "Disable strategies what-if" "What-if should report visible strategy checkbox count without changing state." $enableScript @("-Enabled", "false", "-WhatIf")
        }
    }
}
catch {
    Add-Result "Harness" "Unhandled exception" "The harness should complete without throwing." "FAIL" $_.Exception.Message (Take-Screenshot "harness-exception")
}
finally {
    if ($CloseWhenDone -and $script:LaunchedProcess -and $null -ne $process) {
        try {
            $process.CloseMainWindow() | Out-Null
            Start-Sleep -Seconds 2
            if (-not $process.HasExited) { $process.Kill() }
            Add-Result "Cleanup" "Close manager" "Launched manager should close." "PASS" "Closed PID $($process.Id)." ""
        } catch {
            Add-Result "Cleanup" "Close manager" "Launched manager should close." "WARN" $_.Exception.Message ""
        }
    }

    $summary = [pscustomobject]@{
        Pass = @($script:Results | Where-Object Status -eq "PASS").Count
        Fail = @($script:Results | Where-Object Status -eq "FAIL").Count
        Warn = @($script:Results | Where-Object Status -eq "WARN").Count
        Skip = @($script:Results | Where-Object Status -eq "SKIP").Count
    }

    $script:Results | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonPath -Encoding UTF8

    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add("# Vincere Ninja Manager Production Readiness Report") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("- Run time: $(Get-Date -Format s)") | Out-Null
    $lines.Add(("- App path: ``{0}``" -f $AppPath)) | Out-Null
    $lines.Add(("- Blueprint path: ``{0}``" -f $BlueprintPath)) | Out-Null
    $lines.Add(("- Output folder: ``{0}``" -f $OutputRoot)) | Out-Null
    $lines.Add("- Summary: PASS=$($summary.Pass), FAIL=$($summary.Fail), WARN=$($summary.Warn), SKIP=$($summary.Skip)") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("## Results") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("| Status | Area | Check | Expected | Actual | Screenshot |") | Out-Null
    $lines.Add("|---|---|---|---|---|---|") | Out-Null
    function Escape-MarkdownCell([string]$Value) {
        if ($null -eq $Value) { return "" }
        $Value.Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
    }

    foreach ($r in $script:Results) {
        $shot = ""
        if (-not [string]::IsNullOrWhiteSpace($r.Screenshot)) {
            if ($r.Screenshot.StartsWith($OutputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                $rel = $r.Screenshot.Substring($OutputRoot.Length).TrimStart("\", "/")
            } else {
                $rel = $r.Screenshot
            }
            $rel = $rel -replace "\\", "/"
            $shot = "[image]($rel)"
        }
        $expected = Escape-MarkdownCell $r.Expected
        $actual = Escape-MarkdownCell $r.Actual
        $area = Escape-MarkdownCell $r.Area
        $check = Escape-MarkdownCell $r.Check
        $lines.Add("| $($r.Status) | $area | $check | $expected | $actual | $shot |") | Out-Null
    }
    $lines.Add("") | Out-Null
    $lines.Add("## Human Verification Still Required") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("- Confirm account mappings are financially correct and not just syntactically valid.") | Out-Null
    $lines.Add("- Confirm full live Add All does not create duplicates after starting from a clean NinjaTrader Strategies grid.") | Out-Null
    $lines.Add("- Confirm prop firm connection state in the broker UI, because UI Automation can click buttons but cannot independently validate brokerage state.") | Out-Null
    $lines.Add("- Confirm no live orders are placed during setup and that all strategies remain disabled until the intended enable step.") | Out-Null
    $lines.Add("- Confirm Whop/license behavior with real production keys and backend secrets.") | Out-Null
    $lines.Add("- Watch at least one scheduled morning sequence in real time: launch, connect, apply/verify, enable, and health monitoring.") | Out-Null

    Set-Content -Path $reportPath -Value $lines -Encoding UTF8
    Write-Host ""
    Write-Host "Report: $reportPath" -ForegroundColor Cyan
    Write-Host "JSON:   $jsonPath" -ForegroundColor Cyan

    if ($summary.Fail -gt 0) { exit 1 }
    exit 0
}
