$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$sig = @'
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@
Add-Type -MemberDefinition $sig -Name WinUi -Namespace Native

$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$process = Get-Process Vincere.Operator -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $process) {
    Write-Host "Vincere.Operator is not running."
    exit 1
}

$condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), $process.Id
$window = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
if ($null -eq $window) {
    Write-Host "Vincere.Operator window not found."
    exit 1
}

$handle = [IntPtr]$window.Current.NativeWindowHandle
[Native.WinUi]::ShowWindow($handle, 9) | Out-Null
[Native.WinUi]::SetForegroundWindow($handle) | Out-Null
try { $window.SetFocus() } catch {}
Write-Host "brought-to-front"
