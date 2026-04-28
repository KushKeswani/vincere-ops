using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Vincere.Core.Data;

namespace Vincere.Core.Services;

/// <summary>
/// Imports blueprint-style spreadsheets — maps flexible headers (contains Account / Template / Strategy / Label / Stack).
/// </summary>
public sealed class ExcelImportService
{
    private readonly IDbContextFactory<VincereDbContext> _dbFactory;
    private readonly ILogger<ExcelImportService> _logger;

    public ExcelImportService(IDbContextFactory<VincereDbContext> dbFactory, ILogger<ExcelImportService> logger)
    {
        _dbFactory = dbFactory;
        _logger = logger;
    }

    public sealed record ImportedRowDto(
        string RawAccountHint,
        string StrategyType,
        string TemplateName,
        string InstanceLabel,
        string? StackId,
        string TradingPeriod);

    /// <returns>Flattened rows + unmatched raw accounts needing mapping UX.</returns>
    public Task<(List<ImportedRowDto> Rows, HashSet<string> DistinctAccounts)> ParseAsync(Stream xlsxStream,
        CancellationToken ct)
        => Task.Run(() =>
        {
            using var workbook = new XLWorkbook(xlsxStream);
            var ws = workbook.Worksheet(1);
            var rows = new List<ImportedRowDto>();
            var accounts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var headerRow = ws.FirstRowUsed()?.RowNumber() ?? 1;
            var cols = ws.LastColumnUsed()?.ColumnNumber() ?? 1;
            var hdrMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (int c = 1; c <= cols; c++)
            {
                var t = ws.Cell(headerRow, c).GetString().Trim();
                if (t.Length == 0) continue;
                hdrMap[t] = c;
            }

            int? Col(string key) => hdrMap.TryGetValue(key, out var n) ? n : (int?)null;

            int? FindCol(params string[] parts)
            {
                foreach (var kv in hdrMap)
                {
                    if (parts.Any(p => kv.Key.Contains(p, StringComparison.OrdinalIgnoreCase)))
                        return kv.Value;
                }

                return null;
            }

            var cAcc = Col("Account") ?? Col("AccountNumber") ?? Col("RawAccount") ??
                       FindCol("account", "number", "login");
            var cType = Col("StrategyType") ?? Col("Algo") ?? FindCol("strategy", "type", "algo");
            var cTempl = Col("TemplateName") ?? Col("Template") ?? FindCol("template");
            var cLabel = Col("InstanceLabel") ?? Col("Label") ?? Col("Name") ?? FindCol("label", "name", "instance");
            var cStack = Col("StackId") ?? Col("AlgoStack") ?? FindCol("stack");
            var cPeriod = Col("Period") ?? Col("TradingPeriod") ?? Col("EvalPeriod") ??
                          FindCol("period", "session", "eval");

            if (cAcc is null)
            {
                _logger.LogWarning("Could not find an account column in the first row; import may be empty.");
            }

            var last = ws.LastRowUsed()?.RowNumber() ?? headerRow;
            for (int r = headerRow + 1; r <= last; r++)
            {
                var acc = cAcc is not null ? ws.Cell(r, cAcc.Value).GetString().Trim() : "";
                if (string.IsNullOrWhiteSpace(acc))
                    continue;
                accounts.Add(acc);
                var type = cType is not null ? ws.Cell(r, cType.Value).GetString().Trim() : "";
                var tpl = cTempl is not null ? ws.Cell(r, cTempl.Value).GetString().Trim() : "";
                var label = cLabel is not null ? ws.Cell(r, cLabel.Value).GetString().Trim() : "";
                var stack = cStack is not null ? ws.Cell(r, cStack.Value).GetString().Trim() : null;
                var perRaw = cPeriod is not null ? ws.Cell(r, cPeriod.Value).GetString().Trim() : "";
                rows.Add(new ImportedRowDto(acc, type, tpl, label, stack, NormalizeTradingPeriod(perRaw)));
            }

            return (rows, accounts);
        }, ct);

    internal static string NormalizeTradingPeriod(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return "";
        var t = raw.Trim();
        if (t.Equals("Period 1", StringComparison.OrdinalIgnoreCase) ||
            t.Equals("Period1", StringComparison.OrdinalIgnoreCase) ||
            t.Equals("P1", StringComparison.OrdinalIgnoreCase) ||
            t.Equals("1", StringComparison.OrdinalIgnoreCase))
            return "Period1";
        if (t.Equals("Period 2", StringComparison.OrdinalIgnoreCase) ||
            t.Equals("Period2", StringComparison.OrdinalIgnoreCase) ||
            t.Equals("P2", StringComparison.OrdinalIgnoreCase) ||
            t.Equals("2", StringComparison.OrdinalIgnoreCase))
            return "Period2";
        return "";
    }

    /// <summary>After user maps raw account → existing <see cref="TradingAccountEntity"/>, upsert stack rows.</summary>
    public async Task UpsertStacksFromImportAsync(
        IReadOnlyDictionary<string, Guid> rawToAccountId,
        IReadOnlyList<ImportedRowDto> rows,
        bool replaceExistingForAccount,
        CancellationToken ct)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(ct).ConfigureAwait(false);
        foreach (var g in rows.GroupBy(r => r.RawAccountHint, StringComparer.OrdinalIgnoreCase))
        {
            if (!rawToAccountId.TryGetValue(g.Key, out var accountId))
                continue;
            if (replaceExistingForAccount)
            {
                var old = db.StackStrategies.Where(s => s.AccountId == accountId);
                db.StackStrategies.RemoveRange(old);
            }

            int n = 0;
            foreach (var r in g)
            {
                db.StackStrategies.Add(new StackStrategyRowEntity
                {
                    Id = Guid.NewGuid(),
                    AccountId = accountId,
                    TradingPeriod = r.TradingPeriod,
                    IncludeInApply = true,
                    StrategyTypeName = r.StrategyType,
                    TemplateName = r.TemplateName,
                    InstanceLabel = r.InstanceLabel,
                    AccountAttachment = r.RawAccountHint,
                    SortOrder = n++
                });
            }
        }

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }
}
