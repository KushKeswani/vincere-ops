param(
    [int[]]$Coordinates,
    [int]$PauseMilliseconds = 700,
    [string]$LogPath = "C:\ProgramData\VincereClickDesktopPoints.log"
)

$ErrorActionPreference = "Stop"

function Write-ClickLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

Write-ClickLog "start coordinates=$($Coordinates -join ',') pauseMs=$PauseMilliseconds"

if (-not ("Native.DesktopClickMouse" -as [type])) {
    $sig = @'
[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
    Add-Type -MemberDefinition $sig -Name DesktopClickMouse -Namespace Native
}

if ($Coordinates.Count -eq 0 -or ($Coordinates.Count % 2) -ne 0) {
    throw "Coordinates must be x/y integer pairs."
}

for ($i = 0; $i -lt $Coordinates.Count; $i += 2) {
    $x = $Coordinates[$i]
    $y = $Coordinates[$i + 1]
    Write-ClickLog "click x=$x y=$y"
    [Native.DesktopClickMouse]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 150
    [Native.DesktopClickMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Native.DesktopClickMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds $PauseMilliseconds
}

Write-ClickLog "done"
Write-Host "Clicked $($Coordinates.Count / 2) point(s)."
