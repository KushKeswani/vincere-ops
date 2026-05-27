param(
    [string]$PipeName = "VincereOperator2"
)

$ErrorActionPreference = "Stop"

$client = [System.IO.Pipes.NamedPipeClientStream]::new(".", $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
try {
    $client.Connect(10000)
    $request = @{
        id = [guid]::NewGuid().ToString("N")
        command = "LIST_ACCOUNTS"
    } | ConvertTo-Json -Depth 5 -Compress

    $bytes = [Text.Encoding]::UTF8.GetBytes($request + "`n")
    $client.Write($bytes, 0, $bytes.Length)
    $client.Flush()

    $buffer = New-Object byte[] 65536
    $n = $client.Read($buffer, 0, $buffer.Length)
    if ($n -lt 1) {
        throw "No response from pipe."
    }

    $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $n)
    Write-Host "RAW: $text"
    $clean = $text.TrimStart([char]0xFEFF).Trim()
    $response = $clean | ConvertFrom-Json
    Write-Host "OK: $($response.ok)"
    Write-Host "MESSAGE: $($response.message)"
    Write-Host "ACCOUNTS:"
    $response.payload.accounts | ForEach-Object { Write-Host "  $_" }
}
finally {
    $client.Dispose()
}
