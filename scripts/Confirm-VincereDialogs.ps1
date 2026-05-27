param(
    [string]$DialogName = "Shut Down NinjaTrader",
    [string]$ButtonName = "Yes",
    [int]$MaxDialogs = 5,
    [string]$LogPath = "C:\ProgramData\ConfirmVincereDialogs.log"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

if (-not ("Native.VincereDialogWin32" -as [type])) {
    $sig = @'
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
    Add-Type -MemberDefinition $sig -Name VincereDialogWin32 -Namespace Native
}

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function Write-ConfirmLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Invoke-Or-Click {
    param($Dialog, $Control)

    try {
        $handle = [IntPtr]$Dialog.Current.NativeWindowHandle
        if ($handle -ne [IntPtr]::Zero) {
            [Native.VincereDialogWin32]::SetForegroundWindow($handle) | Out-Null
            Start-Sleep -Milliseconds 200
        }
    } catch {
        Write-ConfirmLog "SetForegroundWindow failed: $($_.Exception.Message)"
    }

    $rect = $Control.Current.BoundingRectangle
    $x = [int]($rect.Left + ($rect.Width / 2))
    $y = [int]($rect.Top + ($rect.Height / 2))
    Write-ConfirmLog "mouse click x=$x y=$y rect=$([int]$rect.Left),$([int]$rect.Top),$([int]$rect.Width),$([int]$rect.Height)"
    [Native.VincereDialogWin32]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 150
    [Native.VincereDialogWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Native.VincereDialogWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$confirmed = 0
Write-ConfirmLog "start dialog='$DialogName' button='$ButtonName'"

for ($attempt = 0; $attempt -lt $MaxDialogs; $attempt++) {
    $dialog = $desktop.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $DialogName))
    if ($null -eq $dialog) {
        Write-ConfirmLog "no dialog found on attempt $attempt"
        break
    }

    try { $dialog.SetFocus() } catch {}
    Write-ConfirmLog "dialog found name='$($dialog.Current.Name)' type='$($dialog.Current.ControlType.ProgrammaticName)' rect='$([int]$dialog.Current.BoundingRectangle.Left),$([int]$dialog.Current.BoundingRectangle.Top),$([int]$dialog.Current.BoundingRectangle.Width),$([int]$dialog.Current.BoundingRectangle.Height)'"
    $button = $dialog.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $ButtonName))
    if ($null -eq $button) { throw "Button '$ButtonName' not found in dialog '$DialogName'." }

    Write-ConfirmLog "control found name='$($button.Current.Name)' type='$($button.Current.ControlType.ProgrammaticName)' rect='$([int]$button.Current.BoundingRectangle.Left),$([int]$button.Current.BoundingRectangle.Top),$([int]$button.Current.BoundingRectangle.Width),$([int]$button.Current.BoundingRectangle.Height)'"
    Invoke-Or-Click $dialog $button
    $confirmed++
    Start-Sleep -Milliseconds 1000
}

Write-ConfirmLog "done confirmed=$confirmed"
Write-Host "Confirmed $confirmed dialog(s) named '$DialogName'."
