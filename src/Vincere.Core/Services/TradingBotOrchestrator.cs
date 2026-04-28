using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
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
    private readonly ILogger<TradingBotOrchestrator> _logger;
    private Timer? _timer;
    private volatile bool _armed;

    public TradingBotOrchestrator(
        IDbContextFactory<VincereDbContext> dbFactory,
        INinjaTraderBridge nt,
        TelegramNotifier telegram,
        AppRuntimeConfig config,
        ReportingService reports,
        ILogger<TradingBotOrchestrator> logger)
    {
        _dbFactory = dbFactory;
        _nt = nt;
        _telegram = telegram;
        _config = config;
        _reports = reports;
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

    private async void OnTick(object? _)
    {
        if (!_armed)
            return;

        try
        {
            await TickAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Orchestrator tick failed");
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
        var enableAt = _config.EnableAllStrategiesTime;
        var eodAt = _config.EodCutoffTime;

        // Connection refresh window [refreshAt, refreshAt + 10 min)
        if (state.LastConnectionRefreshDayIso != todayIso &&
            timeNow >= refreshAt && timeNow < refreshAt.AddMinutes(10))
        {
            await RunRefreshAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }

        // Enable all strategies window [enableAt, enableAt + 15 min)
        if (state.LastEnableAllDayIso != todayIso &&
            timeNow >= enableAt && timeNow < enableAt.AddMinutes(15))
        {
            await RunEnableAllAsync(db, state, todayIso, ct).ConfigureAwait(false);
        }

        // EOD pipeline once after cutoff
        if (state.LastEodDayIso != todayIso && timeNow >= eodAt && timeNow < eodAt.AddHours(6))
        {
            await RunEodAsync(db, state, todayIso, easternNow, ct).ConfigureAwait(false);
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
        var conn = _config.PropConnectionName;
        if (string.IsNullOrWhiteSpace(conn))
        {
            _logger.LogWarning("PROP_CONNECTION_NAME unset; skipping refresh.");
            state.LastConnectionRefreshDayIso = todayIso;
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
            return;
        }

        var payload = JsonSerializer.SerializeToElement(new { connectionName = conn });
        var req = new IpcRequest { Command = IpcCommands.RefreshConnection, Payload = payload };
        var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
        await _telegram.SendAsync($"Connection refresh: {(res?.Ok == true ? "OK" : res?.Message ?? "fail")}", ct).ConfigureAwait(false);
        state.LastConnectionRefreshDayIso = todayIso;
        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private async Task RunEnableAllAsync(VincereDbContext db, AppStateEntity state, string todayIso, CancellationToken ct)
    {
        var req = new IpcRequest { Command = IpcCommands.EnableAllStrategies };
        var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
        await _telegram.SendAsync($"Enable all strategies @ {_config.EnableAllStrategiesTime}: {(res?.Ok == true ? "OK" : res?.Message ?? "fail")}", ct).ConfigureAwait(false);
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

    public void Dispose()
    {
        _timer?.Dispose();
    }
}
