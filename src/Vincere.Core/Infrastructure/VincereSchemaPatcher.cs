using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Vincere.Core.Data;

namespace Vincere.Core.Infrastructure;

/// <summary>Adds columns to SQLite when upgrading without EF migrations.</summary>
public static class VincereSchemaPatcher
{
    public static async Task PatchAsync(VincereDbContext db, CancellationToken ct)
    {
        var stackTable = SafeTableName(db.Model.FindEntityType(typeof(StackStrategyRowEntity))?.GetTableName(),
            "StackStrategies");
        var appStateTable = SafeTableName(db.Model.FindEntityType(typeof(AppStateEntity))?.GetTableName(),
            "AppState");

        await db.Database.OpenConnectionAsync(ct).ConfigureAwait(false);
        try
        {
            if (!await ColumnExistsAsync(db, stackTable, "TradingPeriod", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(stackTable)}\" ADD COLUMN TradingPeriod TEXT NOT NULL DEFAULT ''",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, stackTable, "IncludeInApply", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(stackTable)}\" ADD COLUMN IncludeInApply INTEGER NOT NULL DEFAULT 1",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, stackTable, "Instrument", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(stackTable)}\" ADD COLUMN Instrument TEXT NOT NULL DEFAULT ''",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, appStateTable, "LastCloseAllDayIso", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(appStateTable)}\" ADD COLUMN LastCloseAllDayIso TEXT NULL",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, appStateTable, "LastNinjaTraderResetIso", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(appStateTable)}\" ADD COLUMN LastNinjaTraderResetIso TEXT NULL",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, appStateTable, "LastStackApplyDayIso", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(appStateTable)}\" ADD COLUMN LastStackApplyDayIso TEXT NULL",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, appStateTable, "ActiveTradingPeriod", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(appStateTable)}\" ADD COLUMN ActiveTradingPeriod TEXT NULL",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, appStateTable, "LastAccountCycleIso", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(appStateTable)}\" ADD COLUMN LastAccountCycleIso TEXT NULL",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            await DeduplicateAccountsAsync(db, ct).ConfigureAwait(false);
        }
        finally
        {
            await db.Database.CloseConnectionAsync().ConfigureAwait(false);
        }
    }

    private static string SafeTableName(string? table, string fallback)
    {
        if (string.IsNullOrWhiteSpace(table) || !Regex.IsMatch(table, @"^[A-Za-z0-9_]+$"))
            return fallback;
        return table;
    }

    private static string EscapeIdent(string id) => id.Replace("\"", "\"\"");

    private static async Task DeduplicateAccountsAsync(VincereDbContext db, CancellationToken ct)
    {
        var accounts = await db.Accounts.ToListAsync(ct).ConfigureAwait(false);
        if (accounts.Count < 2)
            return;

        var stackCounts = await db.StackStrategies
            .GroupBy(s => s.AccountId)
            .Select(g => new { AccountId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AccountId, x => x.Count, ct)
            .ConfigureAwait(false);
        var pnlCounts = await db.PerformanceDaily
            .GroupBy(p => p.AccountId)
            .Select(g => new { AccountId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AccountId, x => x.Count, ct)
            .ConfigureAwait(false);

        var duplicates = accounts
            .GroupBy(AccountKey)
            .Where(g => !string.IsNullOrWhiteSpace(g.Key) && g.Count() > 1)
            .ToList();
        if (duplicates.Count == 0)
            return;

        foreach (var group in duplicates)
        {
            var keep = group
                .OrderByDescending(a => stackCounts.GetValueOrDefault(a.Id) + pnlCounts.GetValueOrDefault(a.Id))
                .ThenBy(a => a.CreatedAt)
                .First();
            keep.RawAccountNumber = CleanAccountName(keep.RawAccountNumber);
            keep.DisplayName = string.IsNullOrWhiteSpace(keep.DisplayName)
                ? keep.RawAccountNumber
                : CleanAccountName(keep.DisplayName);

            foreach (var duplicate in group.Where(a => a.Id != keep.Id))
            {
                await db.StackStrategies
                    .Where(s => s.AccountId == duplicate.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.AccountId, keep.Id), ct)
                    .ConfigureAwait(false);
                await db.PerformanceDaily
                    .Where(p => p.AccountId == duplicate.Id)
                    .ExecuteUpdateAsync(p => p.SetProperty(x => x.AccountId, keep.Id), ct)
                    .ConfigureAwait(false);
                await db.ExcelMappings
                    .Where(m => m.MappedAccountId == duplicate.Id)
                    .ExecuteUpdateAsync(m => m.SetProperty(x => x.MappedAccountId, keep.Id), ct)
                    .ConfigureAwait(false);
                db.Accounts.Remove(duplicate);
            }
        }

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    private static string AccountKey(TradingAccountEntity account)
    {
        var raw = CleanAccountName(account.RawAccountNumber);
        if (string.IsNullOrWhiteSpace(raw))
            raw = CleanAccountName(account.DisplayName);
        return raw.ToUpperInvariant();
    }

    private static string CleanAccountName(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "" : value.Trim();

    private static async Task<bool> ColumnExistsAsync(VincereDbContext db, string table, string column,
        CancellationToken ct)
    {
        await using var cmd = db.Database.GetDbConnection().CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{EscapeLit(table)}') WHERE name='{EscapeLit(column)}'";
        var o = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return Convert.ToInt64(o) > 0;
    }

    private static string EscapeLit(string s) => s.Replace("'", "''");
}
