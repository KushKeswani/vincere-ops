using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System.Text;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;

namespace Vincere.Core.Services;

public sealed class ReportingService
{
    private readonly IDbContextFactory<VincereDbContext> _dbFactory;
    private readonly ILogger<ReportingService> _logger;

    public ReportingService(IDbContextFactory<VincereDbContext> dbFactory, ILogger<ReportingService> logger)
    {
        _dbFactory = dbFactory;
        _logger = logger;
    }

    /// <summary>
    /// Stub importer until NinjaTrader CSV pipe exists — creates synthetic rows if DB empty for demos.
    /// </summary>
    public Task ImportPerformanceStubAsync(CancellationToken ct)
    {
        _logger.LogInformation("EOD performance import (stub — replace with NT export watcher)");
        return Task.CompletedTask;
    }

    public async Task<string> BuildEodDigestAsync(CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var eastern = EasternTime.NowEastern.DateTime;
        var date = DateOnly.FromDateTime(eastern);
        var sb = new StringBuilder();
        sb.AppendLine($"Vincere EOD {date:yyyy-MM-dd} Eastern");

        var rows = await db.PerformanceDaily
            .Include(p => p.Account)
            .Where(p => p.DateEastern == date)
            .ToListAsync(ct).ConfigureAwait(false);

        if (rows.Count == 0)
            sb.AppendLine("(No imported performance rows for today yet)");
        foreach (var r in rows)
            sb.AppendLine($"{r.Account?.DisplayName ?? "?"} | PnL {r.Pnl} | trades {r.TradeCount}");

        return sb.ToString();
    }

    public async Task<string> BuildWeeklyDigestAsync(CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var eastern = EasternTime.NowEastern.DateTime;
        var d = DateOnly.FromDateTime(eastern);
        while (d.DayOfWeek != DayOfWeek.Monday)
            d = d.AddDays(-1);
        var startOfWeek = d;
        var endWeek = d.AddDays(4);

        var rows = await db.PerformanceDaily
            .Include(p => p.Account)
            .Where(p => p.DateEastern >= startOfWeek && p.DateEastern <= endWeek)
            .ToListAsync(ct).ConfigureAwait(false);

        var sb = new StringBuilder();
        sb.AppendLine($"Vincere weekly {startOfWeek:yyyy-MM-dd} .. {endWeek:yyyy-MM-dd}");
        foreach (var g in rows.GroupBy(r => r.AccountId))
        {
            var name = g.First().Account?.DisplayName ?? g.Key.ToString();
            sb.AppendLine($"{name}: ΣPnL {g.Sum(x => x.Pnl)} trades {g.Sum(x => x.TradeCount)}");
        }

        return sb.ToString();
    }

    public async Task<string> BuildMonthlyDigestAsync(CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var eastern = EasternTime.NowEastern.DateTime;
        var ymStart = new DateOnly(eastern.Year, eastern.Month, 1);
        var ymEnd = new DateOnly(eastern.Year, eastern.Month,
            DateTime.DaysInMonth(eastern.Year, eastern.Month));

        var rows = await db.PerformanceDaily
            .Include(p => p.Account)
            .Where(p => p.DateEastern >= ymStart && p.DateEastern <= ymEnd)
            .ToListAsync(ct).ConfigureAwait(false);

        var sb = new StringBuilder();
        sb.AppendLine($"Vincere monthly {ymStart:yyyy-MM}");
        foreach (var g in rows.GroupBy(r => r.AccountId))
        {
            var name = g.First().Account?.DisplayName ?? g.Key.ToString();
            sb.AppendLine($"{name}: ΣPnL {g.Sum(x => x.Pnl)} trades {g.Sum(x => x.TradeCount)}");
        }

        return sb.ToString();
    }
}
