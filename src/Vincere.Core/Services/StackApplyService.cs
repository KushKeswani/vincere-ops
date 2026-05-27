using System.Diagnostics;
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

        if (string.IsNullOrWhiteSpace(_config.LicenseKey) || !_config.LicenseVerified)
            return (false, "A verified Vincere / Whop license key is required before applying strategies.");

        var strategies = list.Select(s => new
        {
            strategyType = s.StrategyTypeName,
            instrument = ExcelImportService.ResolveInstrumentForStrategy(s.StrategyTypeName, s.Instrument),
            template = s.TemplateName,
            instanceLabel = s.InstanceLabel,
            account = ResolveNinjaTraderAccount(s.AccountAttachment, acct.RawAccountNumber),
            tradingPeriod = s.TradingPeriod
        }).ToArray();

        await AppendApplyLogAsync("start", acct.RawAccountNumber, dryRun, periodFilter, strategies, null, null, ct)
            .ConfigureAwait(false);

        var root = new
        {
            connectionName = _config.PropConnectionName,
            account = acct.RawAccountNumber,
            licenseKey = _config.LicenseKey,
            dryRun,
            applyPeriodFilter = periodFilter.ToString(),
            strategies
        };

        var payloadJson = JsonSerializer.Serialize(root);
        var uiResult = await TryExecuteUiAutomationAsync(payloadJson, dryRun, ct).ConfigureAwait(false);
        if (uiResult is not null)
        {
            await AppendApplyLogAsync("ui-result", acct.RawAccountNumber, dryRun, periodFilter, strategies,
                    uiResult.Value.Ok, uiResult.Value.Message, ct)
                .ConfigureAwait(false);
            return uiResult.Value;
        }

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
        {
            await AppendApplyLogAsync("ipc-result", acct.RawAccountNumber, dryRun, periodFilter, strategies,
                    false, "No response from NT add-on.", ct)
                .ConfigureAwait(false);
            return (false, "No response from NT add-on.");
        }

        var result = (res.Ok, res.Message ?? (res.Ok ? "OK" : "Error"));
        await AppendApplyLogAsync("ipc-result", acct.RawAccountNumber, dryRun, periodFilter, strategies,
                result.Item1, result.Item2, ct)
            .ConfigureAwait(false);
        return result;
    }

    private static string ResolveNinjaTraderAccount(string? rowAccountAttachment, string selectedAccount)
    {
        if (string.IsNullOrWhiteSpace(rowAccountAttachment))
            return selectedAccount;

        var value = rowAccountAttachment.Trim();
        if (value.Equals(selectedAccount, StringComparison.OrdinalIgnoreCase))
            return selectedAccount;

        // Blueprint labels such as "Lucid Trading #5" describe the prop account,
        // but NinjaTrader's strategy Account combo needs the actual NT account id.
        return LooksLikeNinjaTraderAccount(value) ? value : selectedAccount;
    }

    private static bool LooksLikeNinjaTraderAccount(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;
        return value.StartsWith("APEX", StringComparison.OrdinalIgnoreCase)
               || value.StartsWith("LFE", StringComparison.OrdinalIgnoreCase)
               || value.StartsWith("LTD", StringComparison.OrdinalIgnoreCase)
               || value.StartsWith("SIM", StringComparison.OrdinalIgnoreCase);
    }

    private async Task AppendApplyLogAsync(string stage, string account, bool dryRun, StackApplyPeriodFilter periodFilter,
        object strategies, bool? ok, string? message, CancellationToken ct)
    {
        try
        {
            var logDir = Path.Combine(_config.DataDirectory, "logs");
            Directory.CreateDirectory(logDir);
            var entry = JsonSerializer.Serialize(new
            {
                timestamp = DateTimeOffset.Now,
                stage,
                account,
                dryRun,
                applyPeriodFilter = periodFilter.ToString(),
                strategies,
                ok,
                message
            });
            await File.AppendAllTextAsync(Path.Combine(logDir, "stack-apply.log"),
                    entry + Environment.NewLine, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Unable to write stack apply audit log.");
        }
    }

    private async Task<(bool Ok, string Message)?> TryExecuteUiAutomationAsync(string payloadJson, bool dryRun,
        CancellationToken ct)
    {
        if (!_config.EnableNtUiStackSetup)
            return null;

        var script = FindUiAutomationScript();
        if (string.IsNullOrWhiteSpace(script))
            return (false, "NinjaTrader UI setup is enabled, but Invoke-NinjaTraderUiStackSetup.ps1 was not found.");

        var payloadPath = Path.Combine(Path.GetTempPath(), $"vincere-stack-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(payloadPath, payloadJson, ct).ConfigureAwait(false);

        try
        {
            var args =
                $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -StackJsonPath \"{payloadPath}\"" +
                (dryRun ? " -WhatIf" : "");
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process is null)
                return (false, "Unable to start NinjaTrader UI setup runner.");

            var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = process.StandardError.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct).ConfigureAwait(false);

            var stdout = (await stdoutTask.ConfigureAwait(false)).Trim();
            var stderr = (await stderrTask.ConfigureAwait(false)).Trim();
            var message = string.IsNullOrWhiteSpace(stderr)
                ? stdout
                : string.IsNullOrWhiteSpace(stdout)
                    ? stderr
                    : $"{stdout}\n{stderr}";

            return process.ExitCode == 0
                ? (true, string.IsNullOrWhiteSpace(message) ? "NinjaTrader UI setup completed." : message)
                : (false, string.IsNullOrWhiteSpace(message) ? "NinjaTrader UI setup failed." : message);
        }
        finally
        {
            try
            {
                File.Delete(payloadPath);
            }
            catch
            {
                // Best effort temp-file cleanup.
            }
        }
    }

    private static string? FindUiAutomationScript()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "scripts", "Invoke-NinjaTraderUiStackSetup.ps1"),
            Path.Combine(AppContext.BaseDirectory, "Invoke-NinjaTraderUiStackSetup.ps1"),
            @"C:\Users\Administrator\Desktop\vincere-ops\scripts\Invoke-NinjaTraderUiStackSetup.ps1"
        };

        return candidates.FirstOrDefault(File.Exists);
    }
}
