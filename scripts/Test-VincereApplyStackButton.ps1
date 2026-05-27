param(
    [string]$AppPath = "$env:LOCALAPPDATA\Programs\VincereOps\Vincere.Operator.exe",
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function New-NameCondition([string]$Name) {
    New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::NameProperty), $Name
}

function New-ControlTypeCondition([System.Windows.Automation.ControlType]$Type) {
    New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), $Type
}

function Find-NamedControl($Root, [string]$Name, [System.Windows.Automation.ControlType]$Type) {
    $condition = New-Object System.Windows.Automation.AndCondition `
        (New-NameCondition $Name), (New-ControlTypeCondition $Type)
    $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Find-ControlByAutomationId($Root, [string]$AutomationId, [System.Windows.Automation.ControlType]$Type) {
    $condition = New-Object System.Windows.Automation.AndCondition `
        (New-Object System.Windows.Automation.PropertyCondition `
            ([System.Windows.Automation.AutomationElement]::AutomationIdProperty), $AutomationId), `
        (New-ControlTypeCondition $Type)
    $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Invoke-Element($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label was not found." }
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

function Select-FirstComboItem($Root, [string]$AutomationId, [string]$Label) {
    $combo = Find-ControlByAutomationId $Root $AutomationId ([System.Windows.Automation.ControlType]::ComboBox)
    if ($null -eq $combo) { throw "$Label combo was not found." }

    $pattern = $null
    if ($combo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
        $pattern.Expand()
    } else {
        throw "$Label combo cannot be expanded."
    }

    Start-Sleep -Milliseconds 600

    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $items = $desktop.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-ControlTypeCondition ([System.Windows.Automation.ControlType]::ListItem)))

    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items.Item($i)
        $name = $item.Current.Name
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if ($name -notmatch "^(APEX|LFE|LTD|SIM)") { continue }
        Invoke-Element $item "$Label account $name"
        Start-Sleep -Milliseconds 900
        return $name
    }

    throw "$Label combo did not expose any real NinjaTrader account items."
}

function Get-UiText($Root) {
    $elements = $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    $names = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $elements.Count; $i++) {
        $name = $elements.Item($i).Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $names.Add($name) | Out-Null
        }
    }
    ($names | Select-Object -Unique) -join "`n"
}

function Find-WindowForProcess([int]$ProcessId) {
    $condition = New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), $ProcessId
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        $condition)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $window = $windows.Item($i)
        if ($window.Current.Name -eq "Vincere Ninja Manager - Kush") {
            return $window
        }
    }
    if ($windows.Count -gt 0) { return $windows.Item(0) }
    return $null
}

function Close-OpenResultDialogs([int]$ProcessId) {
    $condition = New-Object System.Windows.Automation.PropertyCondition `
        ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), $ProcessId
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        $condition)
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $window = $windows.Item($i)
        if ($window.Current.Name -eq "Vincere Ninja Manager - Kush") { continue }
        $ok = Find-NamedControl $window "OK" ([System.Windows.Automation.ControlType]::Button)
        if ($null -ne $ok) {
            Invoke-Element $ok "stale result dialog OK button"
            Start-Sleep -Milliseconds 400
        }
    }
}

$process = Get-Process Vincere.Operator -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $process) {
    $process = Start-Process -FilePath $AppPath -PassThru
}

Close-OpenResultDialogs $process.Id

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$root = $null
do {
    $root = Find-WindowForProcess $process.Id
    if ($null -ne $root) { break }
    Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)

if ($null -eq $root) { throw "Vincere main window was not found." }

Invoke-Element (Find-NamedControl $root "Edit Stack" ([System.Windows.Automation.ControlType]::TabItem)) "Edit Stack tab"
Start-Sleep -Milliseconds 800
$editText = Get-UiText $root
if ($editText -match "\b(CDGN|PLPI|OGX|IFSP|MST|DJDR|ARPD|FSA|SYFY|TDC)\b") {
    Write-Host "Default stack account already selected."
} else {
    $selectedAccount = Select-FirstComboItem $root "StackAccountCombo" "Stack account"
    Write-Host "Selected account: $selectedAccount"
    Start-Sleep -Milliseconds 1200
}
Invoke-Element (Find-NamedControl $root "Apply to NinjaTrader" ([System.Windows.Automation.ControlType]::Button)) "Apply to NinjaTrader button"

$deadline = (Get-Date).AddSeconds(8)
do {
    Start-Sleep -Milliseconds 300
    $yes = Find-NamedControl $root "Yes" ([System.Windows.Automation.ControlType]::Button)
    if ($null -ne $yes) {
        Invoke-Element $yes "Confirm Yes button"
        break
    }
} while ((Get-Date) -lt $deadline)

$deadline = (Get-Date).AddSeconds(180)
do {
    Start-Sleep -Milliseconds 500
    $text = Get-UiText $root
    if ($text -match "invalid start of a value|IPC unavailable|0xEF") {
        Write-Host $text
        throw "Apply stack still shows IPC/BOM parse failure."
    }
    if ($text -match "No rows are checked|Stack is empty|Account not found|license key is required") {
        Write-Host $text
        throw "Apply stack precondition failed."
    }
    if ($text -match "WHATIF configured|NinjaTrader UI setup completed|selected strategy '.+?-PF-|loaded template") {
        Write-Host $text
        $ok = Find-NamedControl $root "OK" ([System.Windows.Automation.ControlType]::Button)
        if ($null -ne $ok) {
            Invoke-Element $ok "Apply result OK button"
        }
        exit 0
    }
} while ((Get-Date) -lt $deadline)

Write-Host (Get-UiText $root)
throw "Apply result dialog was not found."
