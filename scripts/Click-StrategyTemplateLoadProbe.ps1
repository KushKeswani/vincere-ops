param(
    [string]$OutPath = "C:\Users\Administrator\Desktop\vincere-ops\logs\strategy-template-load-probe.txt"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

if (-not ("Native.WinUiProbe" -as [type])) {
    $sig = @'
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
    Add-Type -MemberDefinition $sig -Name WinUiProbe -Namespace Native
}

function New-PropertyCondition($Property, $Value) {
    New-Object System.Windows.Automation.PropertyCondition $Property, $Value
}

function SafeRect($Rect) {
    if ($Rect.IsEmpty) { return "empty" }
    "{0},{1},{2},{3}" -f [int]$Rect.X, [int]$Rect.Y, [int]$Rect.Width, [int]$Rect.Height
}

function Test-Visible($Element) {
    if ($null -eq $Element) { return $false }
    try { return -not $Element.Current.BoundingRectangle.IsEmpty } catch { return $false }
}

function Click-Center($Element, [string]$Label) {
    if ($null -eq $Element) { throw "$Label not found." }
    $rect = $Element.Current.BoundingRectangle
    if ($rect.IsEmpty) { throw "$Label empty rect." }
    $x = [int]($rect.X + ($rect.Width / 2))
    $y = [int]($rect.Y + ($rect.Height / 2))
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    [Native.WinUiProbe]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Native.WinUiProbe]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Find-ByAutomationId($Root, [string]$AutomationId) {
    if ($null -eq $Root) { return $null }
    $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) $AutomationId))
}

function Find-ByName($Root, [string]$Name) {
    if ($null -eq $Root) { return $null }
    $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty) $Name))
}

$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add("Template load probe $(Get-Date -Format s)") | Out-Null
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$dialog = $null
foreach ($process in (Get-Process -Name NinjaTrader -ErrorAction SilentlyContinue)) {
    $condition = New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty) $process.Id
    $items = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items.Item($i)
        if ($item.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and
            $item.Current.Name -eq "Strategies" -and
            (Find-ByAutomationId $item "treeAvailableItems")) {
            $dialog = $item
            break
        }
    }
    if ($null -ne $dialog) { break }
}
if ($null -eq $dialog) { throw "Open Strategy dialog not found." }

$slideouts = $dialog.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) "presetSlideout"))
$templateSlideout = $null
for ($i = 0; $i -lt $slideouts.Count; $i++) {
    $candidate = $slideouts.Item($i)
    if ($candidate.Current.ClassName -eq "StrategyTemplateSlideout" -or $candidate.Current.Name -eq "template") {
        $templateSlideout = $candidate
        break
    }
}
if ($null -eq $templateSlideout) { throw "Template slideout not found." }

$header = Find-ByAutomationId $templateSlideout "HeaderSite"
$load = Find-ByName $templateSlideout "load"
$loadRect = "missing"
if ($null -ne $load) { $loadRect = SafeRect $load.Current.BoundingRectangle }
$lines.Add(("before header={0} load={1}" -f (SafeRect $header.Current.BoundingRectangle), $loadRect)) | Out-Null
if (-not (Test-Visible $load)) {
    Click-Center $header "template header"
    Start-Sleep -Milliseconds 700
    $load = Find-ByName $templateSlideout "load"
}
$loadRect = "missing"
if ($null -ne $load) { $loadRect = SafeRect $load.Current.BoundingRectangle }
$lines.Add(("after expand load={0}" -f $loadRect)) | Out-Null
Click-Center $load "template load"
Start-Sleep -Seconds 2

$windows = $desktop.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    (New-PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty) ([System.Windows.Automation.ControlType]::Window)))
for ($i = 0; $i -lt $windows.Count; $i++) {
    $window = $windows.Item($i)
    $current = $window.Current
    $lines.Add(("window name='{0}' class='{1}' aid='{2}' rect={3}" -f $current.Name, $current.ClassName, $current.AutomationId, (SafeRect $current.BoundingRectangle))) | Out-Null
}

Set-Content -Path $OutPath -Value $lines -Encoding UTF8
Write-Host $OutPath
