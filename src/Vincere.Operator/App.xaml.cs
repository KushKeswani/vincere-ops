using System.IO;
using System.Windows;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Vincere.Core;
using Vincere.Core.Data;
using Vincere.Core.Services;

namespace Vincere.Operator;

public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;

    protected override async void OnStartup(StartupEventArgs e)
    {
        try
        {
            base.OnStartup(e);
            TraceStartup("OnStartup begin");

            var sc = new ServiceCollection();
            sc.AddLogging(b =>
            {
                b.AddDebug();
                b.AddConsole();
                b.SetMinimumLevel(LogLevel.Information);
            });
            sc.AddVincereCore();
            Services = sc.BuildServiceProvider();
            TraceStartup("Services built");

            await Services.EnsureVincereDatabaseAsync();
            TraceStartup("Database ensured");

            var dbf = Services.GetRequiredService<IDbContextFactory<VincereDbContext>>();
            await using (var db = await dbf.CreateDbContextAsync())
            {
                var st = await db.AppState.AsNoTracking().FirstAsync();
                var license = Services.GetRequiredService<LicenseVerificationService>();
                if (!st.OnboardingCompleted || !license.HasLocalVerifiedLicense())
                {
                    TraceStartup("Opening onboarding");
                    var onb = new OnboardingWindow(Services);
                    TraceStartup("Onboarding constructed");
                    if (onb.ShowDialog() != true)
                    {
                        TraceStartup("Onboarding cancelled");
                        Shutdown();
                        return;
                    }
                    TraceStartup("Onboarding completed");
                }
            }

            TraceStartup("Opening dashboard");
            var main = new MainWindow(Services);
            main.Show();
            TraceStartup("Dashboard shown");
        }
        catch (Exception ex)
        {
            TraceStartup(ex.ToString());
            MessageBox.Show(ex.Message, "Vincere startup error", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    private static void TraceStartup(string message)
    {
        try
        {
            var root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Vincere.Operator",
                "logs");
            Directory.CreateDirectory(root);
            File.AppendAllText(
                Path.Combine(root, "startup.log"),
                $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // Startup tracing must never block the operator UI.
        }
    }
}
