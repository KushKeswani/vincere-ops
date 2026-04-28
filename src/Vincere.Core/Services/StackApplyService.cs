using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Ipc.Contract;

namespace Vincere.Core.Services;

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

    public async Task<(bool Ok, string Message)> ExecuteAsync(Guid accountId, bool dryRun, CancellationToken ct)
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

        var root = new
        {
            connectionName = _config.PropConnectionName,
            account = acct.RawAccountNumber,
            dryRun,
            strategies = stack.Select(s => new
            {
                strategyType = s.StrategyTypeName,
                template = s.TemplateName,
                instanceLabel = s.InstanceLabel,
                account = s.AccountAttachment ?? acct.RawAccountNumber
            }).ToArray()
        };

        var payload = JsonSerializer.SerializeToElement(root);
        var req = new IpcRequest
        {
            Command = IpcCommands.ApplyStack,
            Payload = payload
        };

        _logger.LogInformation("Stack apply for {Account}", acct.RawAccountNumber);
        var res = await _nt.SendAsync(req, ct).ConfigureAwait(false);
        if (res is null)
            return (false, "No response from NT add-on.");
        return (res.Ok, res.Message ?? (res.Ok ? "OK" : "Error"));
    }
}
