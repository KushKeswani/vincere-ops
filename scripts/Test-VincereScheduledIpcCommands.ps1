param(
    [string]$PipeName = "VincereOperator2",
    [string]$ConnectionName = "Apex",
    [int]$ConnectTimeoutMs = 20000
)

$ErrorActionPreference = "Stop"

function Send-VincereIpc {
    param(
        [string]$Command,
        [string]$PayloadJson = "null"
    )

    if ([string]::IsNullOrWhiteSpace($PayloadJson)) {
        $PayloadJson = "null"
    }

    $id = [Guid]::NewGuid().ToString("N")
    $line = '{"id":"' + $id + '","command":"' + $Command + '","payload":' + $PayloadJson + '}' + [char]10

    $client = New-Object System.IO.Pipes.NamedPipeClientStream(
        ".",
        $PipeName,
        [System.IO.Pipes.PipeDirection]::InOut,
        [System.IO.Pipes.PipeOptions]::None
    )
    try {
        $client.Connect($ConnectTimeoutMs)
        $writer = New-Object System.IO.StreamWriter($client, [Text.Encoding]::UTF8, 65536, $true)
        $reader = New-Object System.IO.StreamReader($client, [Text.Encoding]::UTF8, $true, 65536, $true)
        $writer.AutoFlush = $true
        $writer.WriteLine($line.TrimEnd("`n"))
        $response = $reader.ReadLine()
        if ($null -eq $response) { $response = "" }
        $response = $response.Trim()

        Write-Host "COMMAND=$Command"
        Write-Host "RESPONSE=$response"
        return $response
    }
    finally {
        $client.Dispose()
    }
}

Write-Host "Testing scheduled IPC command set against pipe '$PipeName'."
Send-VincereIpc "REFRESH_CONNECTION" ('{"connectionName":"' + ($ConnectionName -replace '"', '\"') + '"}') | Out-Null
Start-Sleep -Seconds 3
Send-VincereIpc "ENABLE_ALL_STRATEGIES" "null" | Out-Null
Send-VincereIpc "FLATTEN_ALL" '{"reason":"scheduler-test","closeAllTimeEastern":"test","cancelWorkingOrders":true,"disableStrategiesAfterFlatten":true,"avoidOvernightHolds":true}' | Out-Null
