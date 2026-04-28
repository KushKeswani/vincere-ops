<#
.SYNOPSIS
    Command-line smoke test for Vincere <-> NinjaTrader named-pipe IPC.
.DESCRIPTION
    Sends one or more PING requests directly to the named pipe and prints raw response text.
    Use this to isolate pipe/connectivity issues from the WPF app UI.

.PARAMETER PipeName
    Pipe name (default: VincereOperator). Must match both add-on constant and .env.
.PARAMETER Attempts
    Number of ping attempts (default: 3).
.PARAMETER ConnectTimeoutMs
    Timeout per connect attempt (default: 10000 ms).
.PARAMETER DelayMs
    Delay between attempts (default: 500 ms).
.EXAMPLE
    .\scripts\Test-VincereIpcSmoke.ps1
.EXAMPLE
    .\scripts\Test-VincereIpcSmoke.ps1 -PipeName VincereOperator2 -Attempts 10 -ConnectTimeoutMs 20000
#>
param(
    [string]$PipeName = "VincereOperator",
    [int]$Attempts = 3,
    [int]$ConnectTimeoutMs = 10000,
    [int]$DelayMs = 500
)

$ErrorActionPreference = "Stop"

if ($Attempts -lt 1) { $Attempts = 1 }
if ($ConnectTimeoutMs -lt 100) { $ConnectTimeoutMs = 100 }
if ($DelayMs -lt 0) { $DelayMs = 0 }

Write-Host "Vincere IPC smoke test" -ForegroundColor Cyan
Write-Host "  User: $env:USERNAME"
Write-Host "  Host: $env:COMPUTERNAME"
Write-Host "  Pipe: $PipeName"
Write-Host "  Attempts: $Attempts"
Write-Host "  Connect timeout: $ConnectTimeoutMs ms"
Write-Host ""

$ok = $false
for ($i = 1; $i -le $Attempts; $i++) {
    $id = [Guid]::NewGuid().ToString("N")
    $payload = "{""id"":""$id"",""command"":""PING"",""payload"":null}"
    Write-Host "[$i/$Attempts] Connecting..." -ForegroundColor Yellow

    $client = $null
    $reader = $null
    $writer = $null
    try {
        $client = New-Object System.IO.Pipes.NamedPipeClientStream(".", $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
        $client.Connect($ConnectTimeoutMs)

        $writer = New-Object System.IO.StreamWriter($client, [System.Text.Encoding]::UTF8, 65536, $true)
        $writer.AutoFlush = $true
        $reader = New-Object System.IO.StreamReader($client, [System.Text.Encoding]::UTF8, $false, 65536, $true)

        $writer.WriteLine($payload)
        $line = $reader.ReadLine()

        if ([string]::IsNullOrWhiteSpace($line)) {
            Write-Host "  FAIL: Connected but empty response." -ForegroundColor Red
        } else {
            Write-Host "  RAW: $line"
            if ($line -match '"ok"\s*:\s*true') {
                Write-Host "  PASS: ok=true" -ForegroundColor Green
                $ok = $true
                break
            }
            Write-Host "  FAIL: response did not contain ok=true" -ForegroundColor Red
        }
    }
    catch {
        Write-Host ("  FAIL: " + $_.Exception.Message) -ForegroundColor Red
    }
    finally {
        try { if ($writer) { $writer.Dispose() } } catch {}
        try { if ($reader) { $reader.Dispose() } } catch {}
        try { if ($client) { $client.Dispose() } } catch {}
    }

    if ($i -lt $Attempts -and $DelayMs -gt 0) {
        Start-Sleep -Milliseconds $DelayMs
    }
}

Write-Host ""
if ($ok) {
    Write-Host "Smoke test PASSED." -ForegroundColor Green
    exit 0
}

Write-Host "Smoke test FAILED." -ForegroundColor Red
Write-Host "If this fails while NT is open and add-on loaded, check:" -ForegroundColor Yellow
Write-Host "  1) Same Windows user for NT and this shell"
Write-Host "  2) Pipe name match (.env + add-on constant)"
Write-Host "  3) NinjaTrader Output shows \"Vincere IPC: loop running.\""
exit 1

