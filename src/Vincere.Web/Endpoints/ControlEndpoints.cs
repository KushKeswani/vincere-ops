using System.Text.Json;
using Vincere.Core.Infrastructure;
using Vincere.Core.Services;
using Vincere.Ipc.Contract;
using Vincere.Web.Hosting;

namespace Vincere.Web.Endpoints;

public static class ControlEndpoints
{
    public static void MapControlEndpoints(this WebApplication app)
    {
        // --- Safe: connection control (no trading; dry-run simulates) ---
        app.MapPost("/api/connections/{name}/connect",
            (string name, INinjaTraderBridge bridge, CancellationToken ct) =>
                ConnectionCommand(bridge, IpcCommands.ConnectConnection, name, ct));

        app.MapPost("/api/connections/{name}/disconnect",
            (string name, INinjaTraderBridge bridge, CancellationToken ct) =>
                ConnectionCommand(bridge, IpcCommands.DisconnectConnection, name, ct));

        app.MapPost("/api/connections/{name}/refresh",
            (string name, INinjaTraderBridge bridge, CancellationToken ct) =>
                ConnectionCommand(bridge, IpcCommands.RefreshConnection, name, ct));

        // --- Safe: disabling strategies is the safe direction (stops trading) ---
        app.MapPost("/api/strategies/disable-all", async (INinjaTraderBridge bridge, CancellationToken ct) =>
        {
            var res = await bridge.SendAsync(new IpcRequest { Command = IpcCommands.DisableAllStrategies }, ct);
            return Results.Json(WebHelpers.Project(res));
        });

        // --- Guarded: touches live strategies/orders. LiveGuard blocks live firing by default. ---
        app.MapPost("/api/strategies/enable-all",
            (GuardedRequest? body, LiveGuard guard, AppRuntimeConfig config, INinjaTraderBridge bridge,
                    CancellationToken ct) =>
                Guarded(guard, config, body?.Confirm, _ => SendCommand(bridge, IpcCommands.EnableAllStrategies, ct)));

        app.MapPost("/api/flatten/all",
            (GuardedRequest? body, LiveGuard guard, AppRuntimeConfig config, INinjaTraderBridge bridge,
                    CancellationToken ct) =>
                Guarded(guard, config, body?.Confirm, _ => SendCommand(bridge, IpcCommands.FlattenAll, ct)));

        app.MapPost("/api/flatten/account/{id}",
            (string id, GuardedRequest? body, LiveGuard guard, AppRuntimeConfig config, INinjaTraderBridge bridge,
                    CancellationToken ct) =>
                Guarded(guard, config, body?.Confirm, _ =>
                {
                    var payload = JsonSerializer.SerializeToElement(new { account = id });
                    return SendCommand(bridge, IpcCommands.FlattenAccount, ct, payload);
                }));

        app.MapPost("/api/stack/apply",
            (StackApplyRequest req, LiveGuard guard, AppRuntimeConfig config, StackApplyService stacks,
                    CancellationToken ct) =>
                Guarded(guard, config, req.Confirm, async live =>
                {
                    var filter = ParsePeriodFilter(req.PeriodFilter);
                    var (ok, message) = await stacks.ExecuteAsync(req.AccountId, dryRun: !live, filter, ct);
                    return new { ok, message };
                }));

        // --- Guarded: full ready workflow (may enable strategies per config). Dry-run only until approved. ---
        app.MapPost("/api/ready/run",
            (GuardedRequest? body, LiveGuard guard, AppRuntimeConfig config, TradingBotOrchestrator orchestrator,
                    CancellationToken ct) =>
                Guarded(guard, config, body?.Confirm, async _ =>
                {
                    var message = await orchestrator.RunGetAlgosReadyNowAsync(ct);
                    return new { ok = true, message };
                }));
    }

    private static async Task<IResult> ConnectionCommand(INinjaTraderBridge bridge, string command, string name,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
            return Results.Json(new { ok = false, message = "Connection name is required." });

        var payload = JsonSerializer.SerializeToElement(new { connectionName = name });
        var res = await bridge.SendAsync(new IpcRequest { Command = command, Payload = payload }, ct);
        return Results.Json(WebHelpers.Project(res));
    }

    private static async Task<object> SendCommand(INinjaTraderBridge bridge, string command, CancellationToken ct,
        JsonElement? payload = null)
    {
        var res = await bridge.SendAsync(new IpcRequest { Command = command, Payload = payload }, ct);
        return WebHelpers.Project(res);
    }

    /// <summary>
    /// Runs <paramref name="action"/> only when firing is permitted. The bool passed to the action is
    /// <c>live</c> (true = fire live, false = simulate). When the host is in DRY_RUN the action still runs
    /// (downstream simulates); when it is not in DRY_RUN and LiveGuard has not approved, the action is
    /// refused entirely and never reaches NinjaTrader.
    /// </summary>
    private static async Task<IResult> Guarded(LiveGuard guard, AppRuntimeConfig config, string? confirm,
        Func<bool, Task<object>> action)
    {
        var decision = guard.Evaluate(confirm);
        var mayRun = config.DryRun || decision.Allowed;

        if (!mayRun)
            return Results.Json(new { ok = false, blocked = true, message = decision.Reason });

        var result = await action(decision.Allowed);
        return Results.Json(new { blocked = !decision.Allowed, note = decision.Reason, result });
    }

    private static StackApplyPeriodFilter ParsePeriodFilter(string? raw) => raw?.Trim().ToLowerInvariant() switch
    {
        "period1" or "period1only" or "period 1" => StackApplyPeriodFilter.Period1Only,
        "period2" or "period2only" or "period 2" => StackApplyPeriodFilter.Period2Only,
        _ => StackApplyPeriodFilter.AllEnabled
    };
}
