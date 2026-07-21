using Microsoft.EntityFrameworkCore;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Core.Services;
using Vincere.Ipc.Contract;

namespace Vincere.Web.Endpoints;

/// <summary>Read-only / low-risk endpoints. Safe to serve live.</summary>
public static class StatusEndpoints
{
    public static void MapStatusEndpoints(this WebApplication app)
    {
        app.MapGet("/api/status", (AppRuntimeConfig config, TradingBotOrchestrator orchestrator,
            IDbContextFactory<VincereDbContext> dbf) => GetStatusAsync(config, orchestrator, dbf));

        app.MapGet("/api/ping", async (INinjaTraderBridge bridge, CancellationToken ct) =>
        {
            var res = await bridge.SendAsync(new IpcRequest { Command = IpcCommands.Ping }, ct);
            return Results.Json(WebHelpers.Project(res));
        });

        app.MapGet("/api/connections", async (INinjaTraderBridge bridge, CancellationToken ct) =>
        {
            var res = await bridge.SendAsync(new IpcRequest { Command = IpcCommands.ListConnections }, ct);
            return Results.Json(WebHelpers.Project(res));
        });

        app.MapGet("/api/accounts", async (IDbContextFactory<VincereDbContext> dbf, CancellationToken ct) =>
        {
            await using var db = await dbf.CreateDbContextAsync(ct);
            var accounts = await db.Accounts
                .OrderBy(a => a.DisplayName)
                .Select(a => new { a.Id, a.DisplayName, a.RawAccountNumber })
                .ToListAsync(ct);

            var masked = accounts.Select(a => new
            {
                id = a.Id,
                displayName = a.DisplayName,
                accountMasked = WebHelpers.MaskAccount(a.RawAccountNumber)
            });
            return Results.Json(new { ok = true, accounts = masked });
        });
    }

    private static async Task<IResult> GetStatusAsync(AppRuntimeConfig config, TradingBotOrchestrator orchestrator,
        IDbContextFactory<VincereDbContext> dbf)
    {
        await using var db = await dbf.CreateDbContextAsync();
        var state = await db.AppState.AsNoTracking().FirstOrDefaultAsync();

        return Results.Json(new
        {
            ok = true,
            dryRun = config.DryRun,
            armed = orchestrator.IsArmed,
            schedule = new
            {
                enabled = config.ReadyAlgosScheduleEnabled,
                time = config.ReadyAlgosTime.ToString("HH:mm"),
                timezone = "Eastern",
                enableStrategies = config.ReadyAlgosEnableStrategies
            },
            markers = new
            {
                lastReadyAlgosDay = state?.LastReadyAlgosDayIso,
                lastConnectionRefreshDay = state?.LastConnectionRefreshDayIso,
                lastStackApplyDay = state?.LastStackApplyDayIso,
                lastEnableAllDay = state?.LastEnableAllDayIso,
                onboardingCompleted = state?.OnboardingCompleted ?? false
            }
        });
    }
}
