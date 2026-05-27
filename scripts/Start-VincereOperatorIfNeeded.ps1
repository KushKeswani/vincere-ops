param()

$existing = Get-Process -Name Vincere.Operator -ErrorAction SilentlyContinue
if ($existing) {
    exit 0
}

Start-Process -FilePath "$env:LOCALAPPDATA\Programs\VincereOps\Vincere.Operator.exe"
