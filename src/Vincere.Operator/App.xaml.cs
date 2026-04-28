using System.Windows;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vincere.Core;
using Vincere.Core.Data;

namespace Vincere.Operator;

public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var sc = new ServiceCollection();
        sc.AddLogging(b =>
        {
            b.AddDebug();
            b.AddConsole();
            b.SetMinimumLevel(LogLevel.Information);
        });
        sc.AddVincereCore();
        Services = sc.BuildServiceProvider();

        await Services.EnsureVincereDatabaseAsync();

        var dbf = Services.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using (var db = await dbf.CreateDbContextAsync())
        {
            var st = await db.AppState.AsNoTracking().FirstAsync();
            if (!st.OnboardingCompleted)
            {
                var onb = new OnboardingWindow(Services);
                if (onb.ShowDialog() != true)
                {
                    Shutdown();
                    return;
                }
            }
        }

        var main = new MainWindow(Services);
        main.Show();
    }
}
