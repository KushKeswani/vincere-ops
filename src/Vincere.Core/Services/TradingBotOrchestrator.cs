using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Text.Json;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Ipc.Contract;

namespace Vincere.Core.Services;

/// <summary>
/// Mon–Fri Eastern scheduler: connection refresh, enable-all, EOD & digest triggers.
/// </summary>
public sealed class TradingBotOrchestrator : IDisposable
{
    private readonly IDbContextFactory<VincereDbContext> _dbFactory;
    private readonly INinjaTraderBridge _nt;
    private readonly TelegramNotifier _telegram;
    private readonly AppRuntimeConfig _config;
    private readonly ReportingService _reports;
    private readonly StackApplyService _stackApply;
    private readonly NinjaTraderProcessService _ntProcess;
    private readonly ILogger<TradingBotOrchestrator> _logger;
    private Timer? _timer;
    private volatile bool _armed;
    private int _tickInFlight;

    public TradingBotOrchestrator(
        IDbContextFactory<VincereDbContext> dbFactory,
        INinjaTraderBridge nt,
        TelegramNotifier telegram,
        AppRuntimeConfig config,
        ReportingService reports,
        StackApplyService stackApply,
        NinjaTraderProcessService ntProcess,
        ILogger<TradingBotOrchestrator> logger)
    {
        _dbFactory = dbFactory;
        _nt = nt;
        _telegram = telegram;
        _config = config;
        _reports = reports;
        _stackApply = stackApply;
        _ntProcess = ntProcess;
        _logger = logger;
    }

    public bool IsArmed => _armed;

    public void Start()
    {
        _armed = true;
        _timer ??= new Timer(OnTick, null, TimeSpan.Zero, TimeSpan.FromSeconds(45));
    }

    public void Stop()
    {
        _armed = false;
    }

    public async Task<string> RunGetAlgosReadyNowAsync(CancellationToken ct = default)
    {
        var easternNow = EasternTime.NowEastern;
        var todayIso = DateOnly.FromDateTime(easternNow.DateTime).ToString("yyyy-MM-dd");

        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var state = await db.AppState.FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (state is null || !state.OnboardingCompleted)
            return "Get algos ready skipped: setup is not completed.";

        return await RunGetAlgosReadyAsync(db, state, todayIso, easternNow, ct).ConfigureAwait(false);
    }

    private async void OnTick(object? _)
    {
        if (!_armed)
            return;

        if (Interlocked.Exchange(ref _tickInFlight, 1) == 1)
            return;

        try
        {
            await TickAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Orchestrator tick failed");
        }
        finally
        {
            Interlocked.Exchange(ref _tickInFlight, 0);
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var easternNow = EasternTime.NowEastern;
        var dow = easternNow.DayOfWeek;
        if (dow is DayOfWeek.Saturday or DayOfWeek.Sunday)
            return;

        var todayIso = DateOnly.FromDateTime(easternNow.DateTime).ToString("yyyy-MM-dd");
        var timeNow = TimeOnly.FromDateTime(easternNow.DateTime);

        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var state = await db.AppState.FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (state is null || !state.OnboardingCompleted)
            return;

        var refreshAt = _config.ConnectionRefreshTime;
        var stackApplyAt = _config.StackApplyTime;
        var enableAt = _config.EnableAllStrategiesTime;
        var eodAt = _config.EodCutoffTime;
        var closeAllAt = _config.CloseAllTime;
        var ntResetAt = refreshAt.AddMinutes(-15);
        var readyAt = _config.ReadyAlgosTime;

        // Scheduled NT reset window [connection refresh - 15 min, + 10 min)
        if (ShouldRunNinjaTraderReset(state, todayIso, easternNow, timeNow, ntResetAt))
        {
            await RunNinjaTraderResetAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }

        // One-click/day-ready workflow window [readyAt, readyAt + 45 min).
        if (_config.ReadyAlgosScheduleEnabled &&
            state.LastReadyAlgosDayIso != todayIso &&
            timeNow >= readyAt && timeNow < readyAt.AddMinutes(45))
        {
            await RunGetAlgosReadyAsync(db, state, todayIso, easternNow, ct).ConfigureAwait(false);
        }

        // Legacy connection refresh window [refreshAt, refreshAt + 10 min)
        if (!_config.ReadyAlgosScheduleEnabled &&
            state.LastConnectionRefreshDayIso != todayIso &&
            timeNow >= refreshAt && timeNow < refreshAt.AddMinutes(10))
        {
            await RunRefreshAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }

        // Legacy daily setup window [stackApplyAt, stackApplyAt + 25 min).
        // This re-applies the current cycling period before enabling algos.
        if (!_config.ReadyAlgosScheduleEnabled &&
            _config.AutoApplyStacks &&
            state.LastStackApplyDayIso != todayIso &&
            timeNow >= stackApplyAt && timeNow < stackApplyAt.AddMinutes(25))
        {
            await RunStackApplyAsync(db, state, todayIso, easternNow, ct).ConfigureAwait(false);
        }

        // Legacy enable all strategies window [enableAt, enableAt + 15 min)
        if (!_config.ReadyAlgosScheduleEnabled &&
            _config.LegacyEnableAllEnabled &&
            state.LastEnableAllDayIso != todayIso &&
            timeNow >= enableAt && timeNow < enableAt.AddMinutes(15))
        {
            await RunEnableAllAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }

        // EOD pipeline once after cutoff
        if (state.LastEodDayIso != todayIso && timeNow >= eodAt && timeNow < eodAt.AddHours(6))
        {
            await RunEodAsync(db, state, todayIso, easternNow, ct).ConfigureAwait(false);
        }

        // Prop-compliance close-all window [closeAllAt, closeAllAt + 10 min)
        if (_config.CloseAllBeforeEod &&
            state.LastCloseAllDayIso != todayIso &&
            timeNow >= closeAllAt && timeNow < closeAllAt.AddMinutes(10))
        {
            await RunCloseAllAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }

        // Weekly — Fridays after EOD window start
        if (dow == DayOfWeek.Friday &&
            state.LastWeeklyReportFridayIso != todayIso &&
            timeNow >= eodAt)
        {
            var txt = await _reports.BuildWeeklyDigestAsync(ct).ConfigureAwait(false);
            await _telegram.SendAsync(txt, ct).ConfigureAwait(false);
            state.LastWeeklyReportFridayIso = todayIso;
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }

        // Monthly — last eastern calendar day of month after EOD cutoff (naïve)
        var lastDayOfMonth = DateOnly.FromDateTime(new DateTime(easternNow.Year, easternNow.Month,
            DateTime.DaysInMonth(easternNow.Year, easternNow.Month)));
        var easternDateOnly = DateOnly.FromDateTime(easternNow.DateTime);
        var ym = $"{easternNow.Year:D4}-{easternNow.Month:D2}";
        if (easternDateOnly == lastDayOfMonth &&
            state.LastMonthlyReportYm != ym &&
            timeNow >= eodAt)
        {
            var txt = await _reports.BuildMonthlyDigestAsync(ct).ConfigureAwait(false);
            await _telegram.SendAsync(txt, ct).ConfigureAwait(false);
            state.LastMonthlyReportYm = ym;
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
    }

    private async Task RunRefreshAsync(VincereDbContext db, AppStateEntity state, string todayIso, CancellationToken ct)
    {
        var connections = SplitConnectionNames(_config.PropConnectionName);
        if (connections.Count == 0)
        {
            _logger.LogWarning("PROP_CONNECTION_NAME unset; skipping refresh.");
            state.LastConnectionRefreshDayIso = todayIso;
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            return;
        }

        var results = new List<string>();
        foreach (var conn in connections)
        {
            var payload = JsonSerializer.SerializeToElement(new { connectionName = conn });
            var req = new IpcRequest { Command = IpcCommands.RefreshConnection, Payload = payload };
            var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
            results.Add($"{conn}: {(res?.Ok == true ? "OK" : res?.Message ?? "fail")}");
        }

        await _telegram.SendAsync($"Connection refresh: {string.Join(" | ", results)}", ct)
            .ConfigureAwait(false);
        state.LastConnectionRefreshDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private async Task<string> RunGetAlgosReadyAsync(
        VincereDbContext db,
        AppStateEntity state,
        string todayIso,
        DateTimeOffset easternNow,
        CancellationToken ct)
    {
        var connectionCycle = await RunDisconnectReconnectAsync(ct).ConfigureAwait(false);
        if (!connectionCycle.Ok)
        {
            var skipped = $"Get algos ready skipped enable: {connectionCycle.Message}";
            await _telegram.SendAsync(skipped, ct).ConfigureAwait(false);
            return skipped;
        }

        state.LastConnectionRefreshDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);

        if (_config.AutoApplyStacks)
            await RunStackApplyAsync(db, state, todayIso, easternNow, ct).ConfigureAwait(false);

        if (_config.ReadyAlgosEnableStrategies)
        {
            await RunEnableAllAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }
        else
        {
            await _telegram.SendAsync("Get algos ready: strategies were not enabled because READY_ALGOS_ENABLE_STRATEGIES=false.", ct)
                .ConfigureAwait(false);
        }

        state.LastReadyAlgosDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);

        var enableMode = _config.ReadyAlgosEnableStrategies
            ? "strategies enabled"
            : "strategies left disabled";
        var message = $"Get algos ready @ {_config.ReadyAlgosTime:HH:mm}: {connectionCycle.Message}; {enableMode}.";
        await _telegram.SendAsync(message, ct).ConfigureAwait(false);
        return message;
    }

    private async Task<(bool Ok, string Message)> RunDisconnectReconnectAsync(CancellationToken ct)
    {
        var connections = SplitConnectionNames(_config.PropConnectionName);
        if (connections.Count == 0)
            return (false, "PROP_CONNECTION_NAME is unset.");

        var bridgeResults = new List<string>();
        foreach (var conn in connections)
        {
            var payload = JsonSerializer.SerializeToElement(new { connectionName = conn });
            var disconnect = await _nt.SendAsync(
                    new IpcRequest { Command = IpcCommands.DisconnectConnection, Payload = payload },
                    ct)
                .ConfigureAwait(false);
            bridgeResults.Add($"{conn} disconnect: {(disconnect?.Ok == true ? "OK" : disconnect?.Message ?? "fail")}");
        }

        await Task.Delay(TimeSpan.FromSeconds(_config.DryRun ? 0 : 5), ct).ConfigureAwait(false);

        var allConnected = true;
        foreach (var conn in connections)
        {
            var payload = JsonSerializer.SerializeToElement(new { connectionName = conn });
            var connect = await _nt.SendAsync(
                    new IpcRequest { Command = IpcCommands.ConnectConnection, Payload = payload },
                    ct)
                .ConfigureAwait(false);
            allConnected &= connect?.Ok == true;
            bridgeResults.Add($"{conn} connect: {(connect?.Ok == true ? "OK" : connect?.Message ?? "fail")}");
        }

        return (allConnected, string.Join(" | ", bridgeResults));
    }

    private bool ShouldRunNinjaTraderReset(
        AppStateEntity state,
        string todayIso,
        DateTimeOffset easternNow,
        TimeOnly timeNow,
        TimeOnly resetAt)
    {
        if (!_config.NinjaTraderScheduledResetEnabled)
            return false;
        if (state.LastNinjaTraderResetIso == todayIso)
            return false;
        if (timeNow < resetAt || timeNow >= resetAt.AddMinutes(10))
            return false;

        var today = DateOnly.FromDateTime(easternNow.DateTime);
        if (DateOnly.TryParse(state.LastNinjaTraderResetIso, out var lastReset))
            return today.DayNumber - lastReset.DayNumber >= _config.NinjaTraderResetIntervalDays;

        return true;
    }

    private async Task RunNinjaTraderResetAsync(
        VincereDbContext db,
        AppStateEntity state,
        string todayIso,
        CancellationToken ct)
    {
        var message = _config.DryRun
            ? $"DRY_RUN NinjaTrader reset would run every {_config.NinjaTraderResetIntervalDays} day(s)."
            : await _ntProcess.ResetAsync(ct).ConfigureAwait(false);

        await _telegram.SendAsync(
                $"NinjaTrader scheduled reset: {message}",
                ct)
            .ConfigureAwait(false);
        state.LastNinjaTraderResetIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private async Task RunStackApplyAsync(
        VincereDbContext db,
        AppStateEntity state,
        string todayIso,
        DateTimeOffset easternNow,
        CancellationToken ct)
    {
        var activePeriod = ResolveActiveTradingPeriod(state, easternNow);
        var filter = activePeriod == "Period2"
            ? StackApplyPeriodFilter.Period2Only
            : StackApplyPeriodFilter.Period1Only;

        if (!string.Equals(state.ActiveTradingPeriod, activePeriod, StringComparison.OrdinalIgnoreCase))
        {
            state.ActiveTradingPeriod = activePeriod;
            state.LastAccountCycleIso = todayIso;
        }

        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => db.StackStrategies.Any(s =>
                s.AccountId == a.Id &&
                s.IncludeInApply &&
                s.TradingPeriod == activePeriod))
            .OrderBy(a => a.DisplayName)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (accounts.Count == 0)
        {
            state.LastStackApplyDayIso = todayIso;
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            await _telegram.SendAsync(
                    $"Stack apply skipped: no checked {activePeriod} rows are saved for any account.",
                    ct)
                .ConfigureAwait(false);
            return;
        }

        var results = new List<string>();
        foreach (var account in accounts)
        {
            var result = await _stackApply.ExecuteAsync(account.Id, _config.DryRun, filter, ct)
                .ConfigureAwait(false);
            results.Add($"{account.RawAccountNumber}: {(result.Ok ? "OK" : "FAIL")} {TrimOneLine(result.Message, 160)}");
        }

        state.LastStackApplyDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
        await _telegram.SendAsync(
                $"Stack apply {activePeriod} @ {_config.StackApplyTime}: {string.Join(" | ", results)}",
                ct)
            .ConfigureAwait(false);
    }

    private async Task RunEnableAllAsync(VincereDbContext db, AppStateEntity state, string todayIso, CancellationToken ct)
    {
        var message = _config.UseUiStrategyToggle
            ? await TryRunStrategyToggleScriptAsync(true, ct).ConfigureAwait(false)
            : null;

        if (message is null)
        {
            var req = new IpcRequest { Command = IpcCommands.EnableAllStrategies };
            var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
            message = res?.Ok == true ? "OK" : res?.Message ?? "fail";
        }

        await _telegram.SendAsync($"Enable all strategies @ {_config.EnableAllStrategiesTime}: {message}", ct)
            .ConfigureAwait(false);
        state.LastEnableAllDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private async Task RunEodAsync(VincereDbContext db, AppStateEntity state, string todayIso, DateTimeOffset easternNow, CancellationToken ct)
    {
        await _reports.ImportPerformanceStubAsync(ct).ConfigureAwait(false);
        var digest = await _reports.BuildEodDigestAsync(ct).ConfigureAwait(false);
        await _telegram.SendAsync(digest, ct).ConfigureAwait(false);
        state.LastEodDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private async Task RunCloseAllAsync(VincereDbContext db, AppStateEntity state, string todayIso, CancellationToken ct)
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            reason = "scheduled-close-all-before-eod",
            closeAllTimeEastern = _config.CloseAllTime.ToString("HH:mm"),
            cancelWorkingOrders = true,
            disableStrategiesAfterFlatten = true,
            avoidOvernightHolds = _config.AvoidOvernightHolds
        });
        var req = new IpcRequest { Command = IpcCommands.FlattenAll, Payload = payload };
        var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
        await _telegram.SendAsync(
            $"Close all @ {_config.CloseAllTime}: {(res?.Ok == true ? "OK" : res?.Message ?? "fail")}",
            ct).ConfigureAwait(false);
        state.LastCloseAllDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private string ResolveActiveTradingPeriod(AppStateEntity state, DateTimeOffset easternNow)
    {
        if (!_config.AccountCyclingEnabled)
            return string.IsNullOrWhiteSpace(state.ActiveTradingPeriod) ? "Period1" : state.ActiveTradingPeriod!;

        var start = _config.AccountCyclingStartDate ??
                    DateOnly.FromDateTime(state.CreatedAt.ToOffset(easternNow.Offset).DateTime);
        var today = DateOnly.FromDateTime(easternNow.DateTime);
        var days = Math.Max(0, today.DayNumber - start.DayNumber);
        var cycleIndex = days / _config.AccountCyclingIntervalDays;
        return cycleIndex % 2 == 0 ? "Period1" : "Period2";
    }

    private async Task<string?> TryRunStrategyToggleScriptAsync(bool enabled, CancellationToken ct)
    {
        var script = FindStrategyToggleScript();
        if (string.IsNullOrWhiteSpace(script))
            return null;

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments =
                $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Enabled {enabled.ToString().ToLowerInvariant()}" +
                (_config.DryRun ? " -WhatIf" : ""),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi);
        if (process is null)
            return "strategy toggle script failed to start";

        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct).ConfigureAwait(false);

        var stdout = (await stdoutTask.ConfigureAwait(false)).Trim();
        var stderr = (await stderrTask.ConfigureAwait(false)).Trim();
        var msg = string.IsNullOrWhiteSpace(stderr)
            ? stdout
            : string.IsNullOrWhiteSpace(stdout)
                ? stderr
                : $"{stdout} {stderr}";
        if (string.IsNullOrWhiteSpace(msg))
            msg = process.ExitCode == 0 ? "OK" : "strategy toggle failed";
        return process.ExitCode == 0 ? msg : $"FAIL {msg}";
    }

    private static string? FindStrategyToggleScript()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "scripts", "Set-NinjaTraderStrategiesEnabled.ps1"),
            Path.Combine(AppContext.BaseDirectory, "Set-NinjaTraderStrategiesEnabled.ps1"),
            @"C:\Users\Administrator\Desktop\vincere-ops\scripts\Set-NinjaTraderStrategiesEnabled.ps1"
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    private static List<string> SplitConnectionNames(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return new List<string>();

        return raw.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string TrimOneLine(string? value, int maxLength)
    {
        var text = string.IsNullOrWhiteSpace(value)
            ? ""
            : value.Replace("\r", " ", StringComparison.Ordinal)
                .Replace("\n", " ", StringComparison.Ordinal)
                .Trim();
        return text.Length <= maxLength ? text : text[..maxLength] + "...";
    }

    public void Dispose()
    {
        _timer?.Dispose();
    }
}
