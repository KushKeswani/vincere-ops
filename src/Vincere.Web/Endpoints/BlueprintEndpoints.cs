using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vincere.Core.Data;
using Vincere.Core.Services;

namespace Vincere.Web.Endpoints;

/// <summary>
/// Blueprint upload endpoints. Replaces the old Python server.py parser with the same
/// <see cref="ExcelImportService"/> the desktop importer uses, so preview and import cannot diverge.
/// Note: the C# parser reads .xlsx (ClosedXML). CSV is not supported in the web host — export as .xlsx.
/// </summary>
public static class BlueprintEndpoints
{
    public static void MapBlueprintEndpoints(this WebApplication app)
    {
        app.MapPost("/api/blueprint/preview", async (HttpRequest request, ExcelImportService importer,
            CancellationToken ct) =>
        {
            if (!request.HasFormContentType)
                return Results.Json(new { ok = false, error = "Expected a multipart form upload." }, statusCode: 400);

            var form = await request.ReadFormAsync(ct);
            var file = form.Files["blueprint"];
            if (file is null || file.Length == 0)
                return Results.Json(new { ok = false, error = "No blueprint file was uploaded." }, statusCode: 400);

            if (file.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
                return Results.Json(new
                {
                    ok = false,
                    error = "CSV is not supported in the web host yet — please export the blueprint as .xlsx."
                }, statusCode: 400);

            try
            {
                await using var stream = file.OpenReadStream();
                var (rows, _) = await importer.ParseAsync(stream, ct);
                var projected = rows.Select((r, i) => new
                {
                    rowNumber = i + 2,
                    raw = string.IsNullOrWhiteSpace(r.InstanceLabel) ? r.RawAccountHint : r.InstanceLabel,
                    account = r.RawAccountHint,
                    strategy = r.StrategyType,
                    instrument = r.Instrument,
                    period = r.TradingPeriod,
                    template = r.TemplateName
                });
                return Results.Json(new
                {
                    ok = true,
                    filename = Path.GetFileName(file.FileName),
                    sheet = "Worksheet 1",
                    rows = projected
                });
            }
            catch (Exception ex)
            {
                return Results.Json(new { ok = false, error = $"Could not parse blueprint: {ex.Message}" },
                    statusCode: 400);
            }
        });

        // Import: re-parse the uploaded file server-side and upsert stacks for mapped accounts only.
        // DB-only side effects (no NinjaTrader), so it is safe; unmapped/unknown accounts are skipped.
        app.MapPost("/api/blueprint/import", async (HttpRequest request, ExcelImportService importer,
            IDbContextFactory<VincereDbContext> dbf, CancellationToken ct) =>
        {
            if (!request.HasFormContentType)
                return Results.Json(new { ok = false, error = "Expected a multipart form upload." }, statusCode: 400);

            var form = await request.ReadFormAsync(ct);
            var file = form.Files["blueprint"];
            if (file is null || file.Length == 0)
                return Results.Json(new { ok = false, error = "No blueprint file was uploaded." }, statusCode: 400);
            if (file.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
                return Results.Json(new { ok = false, error = "CSV is not supported in the web host yet." },
                    statusCode: 400);

            var replaceExisting = string.Equals(form["replaceExisting"], "true", StringComparison.OrdinalIgnoreCase);

            Dictionary<string, string>? rawMappings;
            try
            {
                rawMappings = string.IsNullOrWhiteSpace(form["mappings"])
                    ? new Dictionary<string, string>()
                    : JsonSerializer.Deserialize<Dictionary<string, string>>(form["mappings"]!);
            }
            catch (JsonException)
            {
                return Results.Json(new { ok = false, error = "mappings must be a JSON object of rawAccount -> accountId." },
                    statusCode: 400);
            }

            await using var db = await dbf.CreateDbContextAsync(ct);
            var knownIds = await db.Accounts.Select(a => a.Id).ToListAsync(ct);
            var knownSet = knownIds.ToHashSet();

            var rawToAccountId = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
            var skipped = new List<string>();
            foreach (var (raw, idStr) in rawMappings ?? new())
            {
                if (Guid.TryParse(idStr, out var gid) && knownSet.Contains(gid))
                    rawToAccountId[raw] = gid;
                else
                    skipped.Add(raw);
            }

            await using var stream = file.OpenReadStream();
            var (rows, distinctAccounts) = await importer.ParseAsync(stream, ct);

            if (rawToAccountId.Count == 0)
                return Results.Json(new
                {
                    ok = false,
                    error = "No blueprint accounts mapped to real account IDs.",
                    unmappedAccounts = distinctAccounts,
                    skipped
                }, statusCode: 400);

            await importer.UpsertStacksFromImportAsync(rawToAccountId, rows, replaceExisting, ct);

            return Results.Json(new
            {
                ok = true,
                importedAccounts = rawToAccountId.Count,
                importedRows = rows.Count(r => rawToAccountId.ContainsKey(r.RawAccountHint)),
                skipped
            });
        });
    }
}
