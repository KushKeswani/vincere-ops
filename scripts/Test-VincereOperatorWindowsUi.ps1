<#
.SYNOPSIS
    Windows UI smoke test for Vincere Operator / Ninja Manager.

.DESCRIPTION
    Launches or attaches to the installed WPF app, navigates every main tab,
    verifies expected controls are present, and invokes safe buttons.

    Live trading actions are skipped unless -IncludeLiveActions is passed.
    Destructive/persistent actions are skipped unless -IncludeDestructiveActions is passed.

    Run this from an interactive Windows desktop/RDP session. UI Automation cannot
    reliably drive a hidden, locked, or disconnected desktop session.

.PARAMETER AppPath
    Path to Vincere.Operator.exe.

.PARAMETER IncludeLiveActions
    Also click buttons that can connect/disconnect prop firms, enable/disable algos,
    apply stacks to NinjaTrader, or otherwise touch live NinjaTrader state.

.PARAMETER IncludeDestructiveActions
    Also click buttons that can delete rows, import accounts, or persist stack changes.

.PARAMETER BlueprintPath
    Optional .xlsx/.csv path to use when testing the Blueprint Import file dialog.

.PARAMETER CloseWhenDone
    Close the app process if this script launched it.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\Test-VincereOperatorWindowsUi.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\Test-VincereOperatorWindowsUi.ps1 -BlueprintPath "C:\Users\Administrator\Downloads\Vincere_Blueprint.xlsx"

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\Test-VincereOperatorWindowsUi.ps1 -IncludeLiveActions -IncludeDestructiveActions
#>
param(
    [string]$AppPath = "$env:LOCALAPPDATA\Programs\VincereOps\Vincere.Operator.exe",
    [int]$TimeoutSeconds = 30,
    [switch]$IncludeLiveActions,
    [switch]$IncludeDestructiveActions,
    [string]$BlueprintPath = "",
    [switch]$CloseWhenDone
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$script:Results = New-Object 'System.Collections.Generic.List[object]'
$script:ProcessLaunched = $false

function Add-Result {
    param(
        [string]$Name,
        [ValidateSet("PASS", "FAIL", "SKIP")]
        [string]$Status,
        [string]$Detail = ""
    )

    $script:Results.Add([pscustomobject]@{
        Time = (Get-Date).ToString("s")
        Name = $Name
        Status = $Status
        Detail = $Detail
    }) | Out-Null

    $color = "White"
    if ($Status -eq "PASS") { $color = "Green" }
    if ($Status -eq "FAIL") { $color = "Red" }
    if ($Status -eq "SKIP") { $color = "Yellow" }
    Write-Host ("[{0}] {1} {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
}

function New-NameCondition {
    param([string]$Name)
    return New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $Name
    )
}

function New-ProcessCondition {
    param([int]$ProcessId)
    return New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $ProcessId
    )
}

function New-ControlTypeCondition {
    param([System.Windows.Automation.ControlType]$ControlType)
    return New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $ControlType
    )
}

function New-AndCondition {
    param(
        [System.Windows.Automation.Condition]$Left,
        [System.Windows.Automation.Condition]$Right
    )
    return New-Object -TypeName System.Windows.Automation.AndCondition -ArgumentList @($Left, $Right)
}

function Find-ElementByName {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [System.Windows.Automation.TreeScope]$Scope = [System.Windows.Automation.TreeScope]::Descendants
    )
    if ($null -eq $Root) { return $null }
    return $Root.FindFirst($Scope, (New-NameCondition $Name))
}

function Find-ElementByNameAndControlType {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [System.Windows.Automation.ControlType]$ControlType,
        [System.Windows.Automation.TreeScope]$Scope = [System.Windows.Automation.TreeScope]::Descendants
    )
    if ($null -eq $Root) { return $null }
    $condition = New-AndCondition (New-NameCondition $Name) (New-ControlTypeCondition $ControlType)
    return $Root.FindFirst($Scope, $condition)
}

function Get-UiTextSnapshot {
    param([System.Windows.Automation.AutomationElement]$Root)

    if ($null -eq $Root) { return "" }
    $elements = $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )

    $names = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $elements.Count; $i++) {
        $name = $elements.Item($i).Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $names.Add($name) | Out-Null
        }
    }

    return ($names | Select-Object -Unique) -join "`n"
}

function Wait-ForUiText {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Pattern,
        [int]$Seconds = 5
    )

    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $text = Get-UiTextSnapshot $Root
        if ($text -match $Pattern) {
            return $text
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)

    return $null
}

function Assert-UiText {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [string]$Pattern,
        [int]$Seconds = 5
    )

    $text = Wait-ForUiText $Root $Pattern $Seconds
    if ($null -eq $text) {
        Add-Result $Name "FAIL" "Expected UI text matching /$Pattern/ was not found."
    } else {
        Add-Result $Name "PASS" "Matched /$Pattern/."
    }
}

function Assert-NoUiErrorText {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name
    )

    $text = Get-UiTextSnapshot $Root
    if ($text -match "(?i)\b(no response|failed|failure|error|exception|could not|timeout|choose a spreadsheet first|set the prop connection name first|select at least one)\b") {
        $matches = [regex]::Matches($text, "(?im).*(no response|failed|failure|error|exception|could not|timeout|choose a spreadsheet first|set the prop connection name first|select at least one).*")
        $detail = ($matches | Select-Object -First 3 | ForEach-Object { $_.Value.Trim() }) -join " | "
        Add-Result $Name "FAIL" $detail
    } else {
        Add-Result $Name "PASS" "No error text detected."
    }
}

function Select-FirstListItem {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [string]$IncludePattern = ".+",
        [string]$ExcludePattern = ""
    )

    $condition = New-ControlTypeCondition ([System.Windows.Automation.ControlType]::ListItem)
    $items = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items.Item($i)
        $itemName = $item.Current.Name
        if ([string]::IsNullOrWhiteSpace($itemName)) { continue }
        if ($itemName -notmatch $IncludePattern) { continue }
        if (-not [string]::IsNullOrWhiteSpace($ExcludePattern) -and $itemName -match $ExcludePattern) { continue }

        $pattern = $null
        if ($item.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
            $pattern.Select()
            Start-Sleep -Milliseconds 350
            Add-Result $Name "PASS" "Selected '$itemName'."
            return $true
        }
    }

    Add-Result $Name "FAIL" "No selectable list item matched /$IncludePattern/."
    return $false
}

function Find-WindowForProcess {
    param([int]$ProcessId)
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-ProcessCondition $ProcessId
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)

    foreach ($window in $windows) {
        $name = $window.Current.Name
        if ($name -like "*Vincere*" -or $name -like "*Ninja Manager*" -or $name -like "*Dashboard*") {
            return $window
        }
    }

    if ($windows.Count -gt 0) { return $windows.Item(0) }
    return $null
}

function Get-WindowsForProcess {
    param([int]$ProcessId)

    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-AndCondition (New-ProcessCondition $ProcessId) (New-ControlTypeCondition ([System.Windows.Automation.ControlType]::Window))
    return $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Dismiss-ProcessDialogs {
    param(
        [System.Diagnostics.Process]$Process,
        [string[]]$ButtonPreference = @("OK", "Cancel", "No", "Close")
    )

    $closed = 0
    $windows = @(Get-WindowsForProcess $Process.Id)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $window = $windows.Item($i)
        $windowName = $window.Current.Name
        if ($windowName -like "*Vincere Ninja Manager*" -or $windowName -like "*Dashboard*") {
            continue
        }

        foreach ($buttonName in ($ButtonPreference + @("&OK", "Ok", "Yes", "&Yes"))) {
            $button = Find-ElementByNameAndControlType $window $buttonName ([System.Windows.Automation.ControlType]::Button)
            if ($null -eq $button) { continue }
            $pattern = $null
            if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
                try {
                    $pattern.Invoke()
                    $closed++
                    Start-Sleep -Milliseconds 350
                    break
                } catch {}
            }
        }
    }

    if ($closed -gt 0) {
        Add-Result "Dismiss modal dialogs" "PASS" "Closed $closed dialog(s)."
    }
}

function Wait-ForWindow {
    param([System.Diagnostics.Process]$Process)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try { $Process.Refresh() } catch {}
        $window = Find-WindowForProcess $Process.Id
        if ($null -ne $window) { return $window }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    throw "Could not find a visible UI Automation window for PID $($Process.Id) within $TimeoutSeconds seconds."
}

function Select-Tab {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name
    )

    $element = Find-ElementByNameAndControlType $Root $Name ([System.Windows.Automation.ControlType]::TabItem)
    if ($null -eq $element) {
        $element = Find-ElementByName $Root $Name
    }
    if ($null -eq $element) {
        Add-Result "Tab: $Name" "FAIL" "Tab was not found."
        return $false
    }

    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $pattern.Select()
        Start-Sleep -Milliseconds 350
        Add-Result "Tab: $Name" "PASS" "Selected."
        return $true
    }

    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        Start-Sleep -Milliseconds 350
        Add-Result "Tab: $Name" "PASS" "Invoked fallback."
        return $true
    }

    Add-Result "Tab: $Name" "FAIL" "SelectionItemPattern/InvokePattern were not available."
    return $false
}

function Invoke-NamedControl {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [ValidateSet("Safe", "Live", "Destructive")]
        [string]$Risk = "Safe"
    )

    if ($Risk -eq "Live" -and -not $IncludeLiveActions) {
        Add-Result "Button: $Name" "SKIP" "Live action. Re-run with -IncludeLiveActions to invoke."
        return $false
    }
    if ($Risk -eq "Destructive" -and -not $IncludeDestructiveActions) {
        Add-Result "Button: $Name" "SKIP" "Persistent/destructive action. Re-run with -IncludeDestructiveActions to invoke."
        return $false
    }

    $element = Find-ElementByName $Root $Name
    if ($null -eq $element) {
        Add-Result "Button: $Name" "FAIL" "Control was not found."
        return $false
    }

    if (-not $element.Current.IsEnabled) {
        Add-Result "Button: $Name" "SKIP" "Control exists but is disabled."
        return $false
    }

    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        try {
            $pattern.Invoke()
            Start-Sleep -Milliseconds 500
            Add-Result "Button: $Name" "PASS" "Invoked."
            return $true
        }
        catch {
            Add-Result "Button: $Name" "FAIL" $_.Exception.Message
            return $false
        }
    }

    Add-Result "Button: $Name" "FAIL" "InvokePattern was not available."
    return $false
}

function Assert-ControlExists {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name
    )

    $element = Find-ElementByName $Root $Name
    if ($null -eq $element) {
        Add-Result "Control: $Name" "FAIL" "Not found."
    } else {
        Add-Result "Control: $Name" "PASS" "Found."
    }
}

function Close-TopDialogIfPresent {
    param([System.Diagnostics.Process]$Process)

    $window = Find-WindowForProcess $Process.Id
    if ($null -eq $window) { return }
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Start-Sleep -Milliseconds 350
}

function Clear-ModalDialogs {
    param([int]$Attempts = 3)
    for ($i = 0; $i -lt $Attempts; $i++) {
        [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
        Start-Sleep -Milliseconds 250
    }
}

function Test-BlueprintDialog {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [System.Diagnostics.Process]$Process
    )

    $button = Find-ElementByName $Root "Choose Blueprint .xlsx"
    if ($null -eq $button) {
        Add-Result "Blueprint file picker" "FAIL" "Choose Blueprint .xlsx was not found."
        return
    }

    $pattern = $null
    if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        Add-Result "Blueprint file picker" "FAIL" "InvokePattern was not available."
        return
    }

    try {
        $pattern.Invoke()
        Start-Sleep -Milliseconds 1000

        if ([string]::IsNullOrWhiteSpace($BlueprintPath)) {
            [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
            Add-Result "Blueprint file picker" "PASS" "Opened and closed without import."
            return
        }

        if (-not (Test-Path $BlueprintPath)) {
            [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
            Add-Result "Blueprint file import" "FAIL" "BlueprintPath does not exist: $BlueprintPath"
            return
        }

        [System.Windows.Forms.SendKeys]::SendWait($BlueprintPath)
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Seconds 2
        Add-Result "Blueprint file import" "PASS" "Submitted $BlueprintPath to the file picker."
    }
    catch {
        Close-TopDialogIfPresent $Process
        Add-Result "Blueprint file picker" "FAIL" $_.Exception.Message
    }
}

Write-Host "Vincere Operator Windows UI smoke test" -ForegroundColor Cyan
Write-Host "  AppPath: $AppPath"
Write-Host "  IncludeLiveActions: $IncludeLiveActions"
Write-Host "  IncludeDestructiveActions: $IncludeDestructiveActions"
Write-Host ""

if (-not (Test-Path $AppPath)) {
    Add-Result "Application path" "FAIL" "File not found: $AppPath"
    exit 1
}

$process = Get-Process -Name "Vincere.Operator" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $process) {
    $process = Start-Process -FilePath $AppPath -PassThru
    $script:ProcessLaunched = $true
    Add-Result "Launch application" "PASS" "Started PID $($process.Id)."
} else {
    Add-Result "Attach application" "PASS" "Attached to PID $($process.Id)."
}

$root = Wait-ForWindow $process
Add-Result "Main window" "PASS" $root.Current.Name
Clear-ModalDialogs
Dismiss-ProcessDialogs $process
Clear-ModalDialogs

Assert-ControlExists $root "Vincere Trading Ninja Manager"
Assert-ControlExists $root "NinjaTrader: Managed"
Assert-ControlExists $root "Bot:"

if ($IncludeLiveActions -or $IncludeDestructiveActions) {
    Dismiss-ProcessDialogs $process
    if (Select-Tab $root "Settings") {
        Assert-ControlExists $root "Prop Firm Setup"
        if (Invoke-NamedControl $root "Scan NinjaTrader") {
            Assert-UiText $root "Status after setup Scan NinjaTrader" "Found [0-9]+ connection\\(s\\) and [0-9]+ account\\(s\\)" 12
            Assert-UiText $root "Setup scan found connections" "Found [1-9][0-9]* connection\\(s\\)" 1
            Assert-UiText $root "Setup scan found accounts" "and [1-9][0-9]* account\\(s\\)" 1
        }

        if ($IncludeLiveActions) {
            if (Select-FirstListItem $root "Select prop connection for live buttons" ".+" "(?i)sim|^[A-Z]{2,}\\d|\\d{4,}") {
                if (Invoke-NamedControl $root "Use Selected Connections") {
                    Assert-UiText $root "Status after setup Use Selected Connections" "Selected prop firm connection\\(s\\) updated" 5
                    Assert-NoUiErrorText $root "Setup Use Selected Connections result"
                }
            }
        }

        if ($IncludeDestructiveActions) {
            $null = Select-FirstListItem $root "Select account for import-account button" "(?i)sim|\\d{4,}|account" ""
        }

        if (Invoke-NamedControl $root "Save All Settings") {
            Assert-UiText $root "Status after setup Save All Settings" "Automation setup saved" 5
            Assert-NoUiErrorText $root "Setup Save All Settings status"
        }
    }
}

if (Select-Tab $root "Dashboard") {
    Dismiss-ProcessDialogs $process
    if (Invoke-NamedControl $root "Start Bot") {
        Assert-UiText $root "State after Start Bot" "Running|Bot armed"
        Assert-NoUiErrorText $root "Start Bot status"
    }
    if (Invoke-NamedControl $root "Stop Bot") {
        Assert-UiText $root "State after Stop Bot" "Stopped"
        Assert-NoUiErrorText $root "Stop Bot status"
    }
    if (Invoke-NamedControl $root "Connect Prop Firms" "Live") {
        Assert-UiText $root "Status after Connect Prop Firms" "Connect prop firms:" 8
        Assert-NoUiErrorText $root "Connect Prop Firms result"
    }
    Close-TopDialogIfPresent $process
    if (Invoke-NamedControl $root "Disconnect Prop Firms" "Live") {
        Assert-UiText $root "Status after Disconnect Prop Firms" "Disconnect prop firms:" 8
        Assert-NoUiErrorText $root "Disconnect Prop Firms result"
    }
    Close-TopDialogIfPresent $process
    if (Invoke-NamedControl $root "Enable Algos" "Live") {
        Assert-UiText $root "Status after Enable Algos" "Enable algos:" 8
        Assert-NoUiErrorText $root "Enable Algos result"
    }
    if (Invoke-NamedControl $root "Disable Algos" "Live") {
        Assert-UiText $root "Status after Disable Algos" "Disable algos:" 8
        Assert-NoUiErrorText $root "Disable Algos result"
    }
    if (Invoke-NamedControl $root "Test IPC") {
        Assert-UiText $root "IPC result after Test IPC" "OK|No response|Failed|timeout|IPC" 8
        Assert-NoUiErrorText $root "Test IPC result"
    }
    if (Invoke-NamedControl $root "Save Setup") {
        Assert-UiText $root "Status after Save Setup" "Automation setup saved"
        Assert-NoUiErrorText $root "Save Setup status"
    }
}

if (Select-Tab $root "Accounts") {
    Dismiss-ProcessDialogs $process
    Assert-ControlExists $root "Accounts"
    Assert-ControlExists $root "Date (Eastern)"
    Assert-ControlExists $root "PnL"
    Assert-ControlExists $root "Trades"
}

if (Select-Tab $root "Edit Stack") {
    Dismiss-ProcessDialogs $process
    Assert-ControlExists $root "Select account"
    Assert-ControlExists $root "Apply to NT"
    if (Invoke-NamedControl $root "Refresh Templates") {
        Assert-UiText $root "Status after Refresh Templates" "Template list refreshed"
        Assert-NoUiErrorText $root "Refresh Templates status"
    }
    $null = Invoke-NamedControl $root "Add Row"
    if (Invoke-NamedControl $root "Delete Selected" "Destructive") {
        Assert-NoUiErrorText $root "Delete Selected status"
    }
    if (Invoke-NamedControl $root "Save Stack" "Destructive") {
        Assert-UiText $root "Status after Save Stack" "Stack saved locally" 8
        Assert-NoUiErrorText $root "Save Stack status"
    }
    if (Invoke-NamedControl $root "Apply to NinjaTrader" "Live") {
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.SendKeys]::SendWait("Y")
        Start-Sleep -Seconds 2
        Assert-NoUiErrorText $root "Apply to NinjaTrader result"
        Close-TopDialogIfPresent $process
    }
}

if (Select-Tab $root "Blueprint Import") {
    Dismiss-ProcessDialogs $process
    Test-BlueprintDialog $root $process
    if (-not [string]::IsNullOrWhiteSpace($BlueprintPath)) {
        Assert-UiText $root "Status after blueprint parse" "Parsed [1-9][0-9]* row" 8
    }
    if (Invoke-NamedControl $root "Import Stacks" "Destructive") {
        Start-Sleep -Seconds 2
        Assert-NoUiErrorText $root "Import Stacks result"
        Close-TopDialogIfPresent $process
    }
}

if (Select-Tab $root "Settings") {
    Dismiss-ProcessDialogs $process
    Assert-ControlExists $root "Prop Firm Setup"
    if (Invoke-NamedControl $root "Save Prop Firm Settings") {
        Assert-UiText $root "Status after Save Prop Firm Settings" "Automation setup saved"
        Assert-NoUiErrorText $root "Save Prop Firm Settings status"
    }
    if (Invoke-NamedControl $root "Scan NinjaTrader") {
        Assert-UiText $root "Status after Scan NinjaTrader" "Found [0-9]+ connection\\(s\\) and [0-9]+ account\\(s\\)" 12
        Assert-UiText $root "NinjaTrader scan found connections" "Found [1-9][0-9]* connection\\(s\\)" 1
        Assert-UiText $root "NinjaTrader scan found accounts" "and [1-9][0-9]* account\\(s\\)" 1
        Assert-NoUiErrorText $root "Scan NinjaTrader status"
    }
    if (Invoke-NamedControl $root "Use Selected Connections") {
        Assert-NoUiErrorText $root "Use Selected Connections result"
        Close-TopDialogIfPresent $process
    }
    if (Invoke-NamedControl $root "Import Selected Accounts" "Destructive") {
        Start-Sleep -Seconds 1
        Assert-NoUiErrorText $root "Import Selected Accounts result"
        Close-TopDialogIfPresent $process
    }
    if (Invoke-NamedControl $root "Save All Settings") {
        Assert-UiText $root "Status after Save All Settings" "Automation setup saved"
        Assert-NoUiErrorText $root "Save All Settings status"
    }
}

if (Select-Tab $root "Developer") {
    Dismiss-ProcessDialogs $process
    $null = Invoke-NamedControl $root "Open Developer Tools"
    Close-TopDialogIfPresent $process
}

Write-Host ""
$failures = @($script:Results | Where-Object { $_.Status -eq "FAIL" })
$skips = @($script:Results | Where-Object { $_.Status -eq "SKIP" })
$passes = @($script:Results | Where-Object { $_.Status -eq "PASS" })

Write-Host ("Summary: {0} passed, {1} skipped, {2} failed" -f $passes.Count, $skips.Count, $failures.Count) -ForegroundColor Cyan

if ($CloseWhenDone -and $script:ProcessLaunched) {
    try {
        $process.CloseMainWindow() | Out-Null
        Start-Sleep -Seconds 2
        if (-not $process.HasExited) { $process.Kill() }
        Add-Result "Close application" "PASS" "Closed launched process."
    }
    catch {
        Add-Result "Close application" "FAIL" $_.Exception.Message
    }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    $failures | Format-Table -AutoSize
    exit 1
}

exit 0
