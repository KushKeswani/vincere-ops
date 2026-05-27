param(
    [string]$EnvPath = "$env:LOCALAPPDATA\Vincere.Operator\.env",
    [string]$NinjaTraderExe = "C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe",
    [int]$WaitSeconds = 75
)

$ErrorActionPreference = "Stop"

try {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
} catch {
    try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop } catch { }
}

function Read-EnvFile {
    param([string]$Path)
    $values = @{}
    if (-not (Test-Path $Path)) { return $values }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -lt 1) { continue }
        $key = $trimmed.Substring(0, $idx).Trim()
        $value = $trimmed.Substring($idx + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }
    return $values
}

function Test-Truthy {
    param([string]$Value)
    return $Value -match "^(true|1|yes)$"
}

function Unprotect-DpapiText {
    param([string]$ProtectedBase64)
    if ([string]::IsNullOrWhiteSpace($ProtectedBase64)) { return "" }
    if ($null -eq ([System.Management.Automation.PSTypeName]'System.Security.Cryptography.ProtectedData').Type) {
        throw "Windows DPAPI ProtectedData could not be loaded in this PowerShell session."
    }
    $bytes = [Convert]::FromBase64String($ProtectedBase64)
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $bytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Text.Encoding]::UTF8.GetString($plainBytes)
}

function Get-ElementName {
    param($Element)
    try { return $Element.Current.Name } catch { return "" }
}

function Set-ElementValue {
    param($Element, [string]$Value)
    try {
        $pattern = $Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $pattern.SetValue($Value)
        return $true
    } catch {
        try {
            $Element.SetFocus()
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            [System.Windows.Forms.SendKeys]::SendWait($Value)
            return $true
        } catch {
            return $false
        }
    }
}

function Find-NinjaTraderWindows {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window)
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    $result = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $windows.Count; $i++) {
        $w = $windows.Item($i)
        try {
            if ($w.Current.ProcessId -in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue).Id) {
                $result.Add($w)
            }
        } catch { }
    }
    return $result
}

$envValues = Read-EnvFile -Path $EnvPath
$process = Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $process) {
    if (-not (Test-Path $NinjaTraderExe)) {
        throw "NinjaTrader executable not found: $NinjaTraderExe"
    }
    Start-Process -FilePath $NinjaTraderExe
}

if (-not (Test-Truthy ($envValues["NT_AUTO_LOGIN_ENABLED"]))) {
    Write-Output "NinjaTrader launch requested. Optional login is disabled."
    exit 0
}

$username = $envValues["NT_LOGIN_USERNAME"]
$protectedPassword = $envValues["NT_LOGIN_PASSWORD_DPAPI"]
if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($protectedPassword)) {
    throw "Optional NinjaTrader login is enabled, but username or encrypted password is missing."
}

$password = Unprotect-DpapiText -ProtectedBase64 $protectedPassword
if ([string]::IsNullOrWhiteSpace($password)) {
    throw "Optional NinjaTrader login password could not be decrypted for this Windows user."
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$loginAttempted = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 750
    $windows = Find-NinjaTraderWindows
    foreach ($window in $windows) {
        $name = Get-ElementName $window
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)
        $edits = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        if ($edits.Count -lt 2) { continue }

        $loginAttempted = $true
        [void](Set-ElementValue $edits.Item(0) $username)
        [void](Set-ElementValue $edits.Item(1) $password)

        $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)
        $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
        for ($i = 0; $i -lt $buttons.Count; $i++) {
            $button = $buttons.Item($i)
            $buttonName = Get-ElementName $button
            if ($buttonName -match "^(Log ?In|Login|Sign ?In|OK|Connect)$") {
                $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $invoke.Invoke()
                Write-Output "Optional NinjaTrader login submitted."
                exit 0
            }
        }

        throw "Found NinjaTrader login fields in '$name' but no login/OK/connect button was found."
    }
}

if ($loginAttempted) {
    Write-Output "Optional NinjaTrader login attempted."
} else {
    Write-Output "NinjaTrader started; no login dialog was found. It may already be logged in."
}
