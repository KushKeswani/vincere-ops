using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;
using Vincere.Ipc.Contract;

namespace Vincere.Core.Services;

public interface INinjaTraderBridge
{
    Task<IpcResponse?> SendAsync(IpcRequest request, CancellationToken cancellationToken = default);
    bool IsDryRunSimulated { get; }
}

public sealed class NinjaTraderIpcBridge : INinjaTraderBridge
{
    private readonly AppRuntimeConfig _config;
    private readonly ILogger<NinjaTraderIpcBridge> _logger;

    public NinjaTraderIpcBridge(AppRuntimeConfig config, ILogger<NinjaTraderIpcBridge> logger)
    {
        _config = config;
        _logger = logger;
    }

    public bool IsDryRunSimulated => _config.DryRun;

    public async Task<IpcResponse?> SendAsync(IpcRequest request, CancellationToken cancellationToken = default)
    {
        if (_config.DryRun)
        {
            return new IpcResponse
            {
                Id = request.Id,
                Ok = true,
                Message = "DRY_RUN simulated success"
            };
        }

        var pipeName = _config.IpcPipeName;
        var attempts = _config.IpcRetryAttempts;
        var delayMs = _config.IpcRetryDelayMs;
        var timeoutMs = _config.IpcConnectTimeoutMs;

        Exception? last = null;
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                using var client = new NamedPipeClientStream(
                    ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);

                await client.ConnectAsync(timeoutMs, cancellationToken).ConfigureAwait(false);

                var line = JsonSerializer.Serialize(request);
                var bytes = Encoding.UTF8.GetBytes(line + "\n");
                await client.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await client.FlushAsync(cancellationToken).ConfigureAwait(false);

                var buffer = new byte[65536];
                var n = await client.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (n == 0)
                    return null;
                var text = Encoding.UTF8.GetString(buffer.AsSpan(0, n)).Trim();
                return JsonSerializer.Deserialize<IpcResponse>(text);
            }
            catch (Exception ex)
            {
                last = ex;
                _logger.LogWarning(ex,
                    "NinjaTrader IPC attempt {Attempt}/{Attempts} failed (pipe={Pipe})",
                    attempt, attempts, pipeName);

                if (attempt < attempts && delayMs > 0)
                    await Task.Delay(delayMs, cancellationToken).ConfigureAwait(false);
            }
        }

        var detail = last?.Message ?? "unknown error";
        _logger.LogWarning("NinjaTrader IPC exhausted retries; add-on may be offline or pipe leaked.");
        return new IpcResponse
        {
            Id = request.Id,
            Ok = false,
            Message =
                $"IPC unavailable after {attempts} attempt(s) ({timeoutMs} ms each): {detail}"
        };
    }
}
