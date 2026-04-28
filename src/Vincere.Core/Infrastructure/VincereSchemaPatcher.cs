using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Vincere.Core.Data;

namespace Vincere.Core.Infrastructure;

/// <summary>Adds columns to SQLite when upgrading without EF migrations.</summary>
public static class VincereSchemaPatcher
{
    public static async Task PatchAsync(VincereDbContext db, CancellationToken ct)
    {
        var entityType = db.Model.FindEntityType(typeof(StackStrategyRowEntity));
        var table = entityType?.GetTableName() ?? "StackStrategies";
        if (!Regex.IsMatch(table, @"^[A-Za-z0-9_]+$"))
            table = "StackStrategies";

        await db.Database.OpenConnectionAsync(ct).ConfigureAwait(false);
        try
        {
            if (!await ColumnExistsAsync(db, table, "TradingPeriod", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(table)}\" ADD COLUMN TradingPeriod TEXT NOT NULL DEFAULT ''",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }

            if (!await ColumnExistsAsync(db, table, "IncludeInApply", ct).ConfigureAwait(false))
            {
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync(
                        $"ALTER TABLE \"{EscapeIdent(table)}\" ADD COLUMN IncludeInApply INTEGER NOT NULL DEFAULT 1",
                        ct)
                    .ConfigureAwait(false);
#pragma warning restore EF1002
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync().ConfigureAwait(false);
        }
    }

    private static string EscapeIdent(string id) => id.Replace("\"", "\"\"");

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
