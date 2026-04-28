using System.Windows;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;

namespace Vincere.Operator;

public partial class OnboardingWindow : Window
{
    private readonly IServiceProvider _sp;

    public OnboardingWindow(IServiceProvider sp)
    {
        _sp = sp;
        InitializeComponent();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        var lines = AccountsBox.Text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (lines.Length == 0)
        {
            MessageBox.Show("Enter at least one account number.", "Validation", MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();

        foreach (var raw in lines)
        {
            db.Accounts.Add(new TradingAccountEntity
            {
                Id = Guid.NewGuid(),
                RawAccountNumber = raw,
                DisplayName = raw
            });
        }

        var state = await db.AppState.FirstAsync();
        state.OnboardingCompleted = true;
        state.ClientInternalId = string.IsNullOrWhiteSpace(ClientIdBox.Text) ? null : ClientIdBox.Text.Trim();
        state.UpdatedAt = DateTimeOffset.UtcNow;

        var settings = _sp.GetRequiredService<AppSettingsProvider>();
        var merged = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(PropConnBox.Text))
            merged[AppRuntimeConfig.KeyPropConnectionName] = PropConnBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(TelegramTokenBox.Text))
            merged[AppRuntimeConfig.KeyTelegramBotToken] = TelegramTokenBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(TelegramChatBox.Text))
            merged[AppRuntimeConfig.KeyTelegramChatId] = TelegramChatBox.Text.Trim();
        settings.UpdateAndSaveEnvFile(merged);

        await db.SaveChangesAsync();

        DialogResult = true;
        Close();
    }
}
