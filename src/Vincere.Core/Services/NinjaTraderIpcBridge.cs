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
        try
        {
            using var client = new NamedPipeClientStream(
                ".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await client.ConnectAsync(_config.IpcConnectTimeoutMs, cancellationToken).ConfigureAwait(false);

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
            _logger.LogWarning(ex, "NinjaTrader IPC failed; add-on may be offline.");
            return new IpcResponse
            {
                Id = request.Id,
                Ok = false,
                Message = "IPC unavailable: " + ex.Message
            };
        }
    }
}
