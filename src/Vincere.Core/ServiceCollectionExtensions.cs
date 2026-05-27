using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Core.Services;

namespace Vincere.Core;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddVincereCore(this IServiceCollection services)
    {
        Directory.CreateDirectory(AppPaths.RootDataDirectory);
        Directory.CreateDirectory(AppPaths.LogsDirectory);

        services.AddSingleton<AppSettingsProvider>(sp =>
        {
            var p = new AppSettingsProvider();
            p.Reload();
            return p;
        });

        services.AddSingleton<AppRuntimeConfig>();
        services.AddSingleton<INinjaTraderBridge, NinjaTraderIpcBridge>();
        services.AddSingleton<TelegramNotifier>();
        services.AddSingleton<NtLogHealthWatcher>();
        services.AddSingleton<LicenseVerificationService>();
        services.AddSingleton<NinjaTraderProcessService>();
        services.AddSingleton<ReportingService>();
        services.AddSingleton<StackApplyService>();
        services.AddSingleton<ExcelImportService>();
        services.AddSingleton<NinjaTraderTemplateDiscoveryService>();
        services.AddSingleton<TradingBotOrchestrator>();
        services.AddDbContextFactory<VincereDbContext>(o =>
            o.UseSqlite($"Data Source={AppPaths.DatabasePath}"));

        return services;
    }

    public static async Task EnsureVincereDatabaseAsync(this IServiceProvider sp, CancellationToken ct = default)
    {
        var f = sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await f.CreateDbContextAsync(ct).ConfigureAwait(false);
        await db.Database.EnsureCreatedAsync(ct).ConfigureAwait(false);
        await VincereSchemaPatcher.PatchAsync(db, ct).ConfigureAwait(false);
        if (!await db.AppState.AnyAsync(ct).ConfigureAwait(false))
        {
            db.AppState.Add(new AppStateEntity { Id = 1, OnboardingCompleted = false });
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
    }
}
