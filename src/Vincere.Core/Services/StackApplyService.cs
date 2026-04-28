using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Ipc.Contract;

namespace Vincere.Core.Services;

public enum StackApplyPeriodFilter
{
    /// <summary>Every row with <see cref="StackStrategyRowEntity.IncludeInApply"/> true.</summary>
    AllEnabled,

    /// <summary>IncludeInApply and <c>TradingPeriod == Period1</c>.</summary>
    Period1Only,

    /// <summary>IncludeInApply and <c>TradingPeriod == Period2</c>.</summary>
    Period2Only,
}

public sealed class StackApplyService
{
    private readonly IDbContextFactory<VincereDbContext> _dbFactory;
    private readonly INinjaTraderBridge _nt;
    private readonly ILogger<StackApplyService> _logger;
    private readonly AppRuntimeConfig _config;

    public StackApplyService(
        IDbContextFactory<VincereDbContext> dbFactory,
        INinjaTraderBridge nt,
        AppRuntimeConfig config,
        ILogger<StackApplyService> logger)
    {
        _dbFactory = dbFactory;
        _nt = nt;
        _config = config;
        _logger = logger;
    }

    public async Task<(bool Ok, string Message)> ExecuteAsync(Guid accountId, bool dryRun,
        StackApplyPeriodFilter periodFilter, CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        var acct = await db.Accounts.FirstOrDefaultAsync(a => a.Id == accountId, ct).ConfigureAwait(false);
        if (acct is null)
            return (false, "Account not found.");

        var stack = await db.StackStrategies
            .Where(s => s.AccountId == accountId)
            .OrderBy(s => s.SortOrder)
            .ToListAsync(ct).ConfigureAwait(false);

        if (stack.Count == 0)
            return (false, "Stack is empty.");

        IEnumerable<StackStrategyRowEntity> filtered = stack.Where(s => s.IncludeInApply);
        filtered = periodFilter switch
        {
            StackApplyPeriodFilter.Period1Only => filtered.Where(s => s.TradingPeriod == "Period1"),
            StackApplyPeriodFilter.Period2Only => filtered.Where(s => s.TradingPeriod == "Period2"),
            _ => filtered
        };

        var list = filtered.ToList();
        if (list.Count == 0)
            return (false,
                "No strategies to apply: enable Apply for rows, set Period if using filters, or change Apply to NT.");

        var root = new
        {
            connectionName = _config.PropConnectionName,
            account = acct.RawAccountNumber,
            dryRun,
            applyPeriodFilter = periodFilter.ToString(),
            strategies = list.Select(s => new
            {
                strategyType = s.StrategyTypeName,
                template = s.TemplateName,
                instanceLabel = s.InstanceLabel,
                account = s.AccountAttachment ?? acct.RawAccountNumber,
                tradingPeriod = s.TradingPeriod
            }).ToArray()
        };

        var payload = JsonSerializer.SerializeToElement(root);
        var req = new IpcRequest
        {
            Command = IpcCommands.ApplyStack,
            Payload = payload
        };

        _logger.LogInformation("Stack apply for {Account} ({Count} rows, filter {Filter})", acct.RawAccountNumber,
            list.Count, periodFilter);
        var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
        if (res is null)
            return (false, "No response from NT add-on.");
        return (res.Ok, res.Message ?? (res.Ok ? "OK" : "Error"));
    }
}
