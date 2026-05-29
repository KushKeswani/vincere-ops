using System.Windows;
using System.Diagnostics;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Controls;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Core.Services;

namespace Vincere.Operator;

public partial class OnboardingWindow : Window
{
    private readonly IServiceProvider _sp;
    private readonly ObservableCollection<string> _discoveredPropConnections = new();
    private readonly ObservableCollection<string> _discoveredAccounts = new();

    public OnboardingWindow(IServiceProvider sp)
    {
        _sp = sp;
        InitializeComponent();
        ApplyLicenseUiVisibility();
        DiscoveredPropConnectionsList.ItemsSource = _discoveredPropConnections;
        DiscoveredAccountsList.ItemsSource = _discoveredAccounts;
    }

    private void ApplyLicenseUiVisibility()
    {
        var config = _sp.GetRequiredService<AppRuntimeConfig>();
        var visible = (config.LicenseUiEnabled || config.LicenseRequired)
            ? Visibility.Visible
            : Visibility.Collapsed;
        LicenseHeaderText.Visibility = visible;
        LicenseRailItem.Visibility = visible;
        LicenseGatePanel.Visibility = visible;
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

        if (NinjaTraderAutoLoginCheck.IsChecked == true
            && (string.IsNullOrWhiteSpace(NinjaTraderUsernameBox.Text)
                || string.IsNullOrWhiteSpace(NinjaTraderPasswordBox.Password)))
        {
            MessageBox.Show(
                "NinjaTrader auto-login is optional. To enable it, enter both username and password. Otherwise uncheck the auto-login box.",
                "Optional NinjaTrader login",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        if (!int.TryParse(NinjaTraderResetDaysBox.Text.Trim(), out var resetDays) || resetDays < 1 || resetDays > 90)
        {
            MessageBox.Show(
                "NinjaTrader reset interval must be a whole number from 1 to 90 days.",
                "NinjaTrader reset schedule",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            NinjaTraderResetDaysBox.Focus();
            return;
        }

        var config = _sp.GetRequiredService<AppRuntimeConfig>();
        var licenseKey = LicenseKeyBox.Text.Trim();
        var verification = new LicenseVerificationResult(true, "License verification is disabled.", "not-required");
        if (config.LicenseRequired)
        {
            var verifier = _sp.GetRequiredService<LicenseVerificationService>();
            verification = await verifier.VerifyAsync(licenseKey);
            if (!verification.Ok)
            {
                MessageBox.Show(verification.Message, "License verification", MessageBoxButton.OK,
                    MessageBoxImage.Warning);
                return;
            }
            if (string.IsNullOrWhiteSpace(licenseKey) &&
                string.Equals(verification.Status, "test-bypass", StringComparison.OrdinalIgnoreCase))
                licenseKey = "TEST-LICENSE-BYPASS";
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
        state.UpdatedAt = DateTimeOffset.UtcNow;

        var settings = _sp.GetRequiredService<AppSettingsProvider>();
        var merged = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(PropFirmBox.Text))
            merged[AppRuntimeConfig.KeyPropFirm] = PropFirmBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(AccountTypeBox.Text))
            merged[AppRuntimeConfig.KeyAccountType] = AccountTypeBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(PropConnBox.Text))
            merged[AppRuntimeConfig.KeyPropConnectionName] = PropConnBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(TradingPlatformBox.Text))
            merged[AppRuntimeConfig.KeyTradingPlatform] = TradingPlatformBox.Text.Trim();
        else
            merged[AppRuntimeConfig.KeyTradingPlatform] = "NinjaTrader 8";
        merged[AppRuntimeConfig.KeyNinjaTraderAutoLoginEnabled] =
            (NinjaTraderAutoLoginCheck.IsChecked == true).ToString();
        merged[AppRuntimeConfig.KeyNinjaTraderLoginUsername] = NinjaTraderUsernameBox.Text.Trim();
        merged[AppRuntimeConfig.KeyNinjaTraderScheduledResetEnabled] =
            (NinjaTraderScheduledResetCheck.IsChecked == true).ToString();
        merged[AppRuntimeConfig.KeyNinjaTraderResetIntervalDays] = resetDays.ToString();
        if (!string.IsNullOrWhiteSpace(NinjaTraderPasswordBox.Password))
            merged[AppRuntimeConfig.KeyNinjaTraderLoginPasswordProtected] =
                WindowsProtectedSecret.Protect(NinjaTraderPasswordBox.Password);
        if (config.LicenseRequired || config.LicenseUiEnabled)
        {
            merged[AppRuntimeConfig.KeyLicenseKey] = licenseKey;
            merged[AppRuntimeConfig.KeyLicenseVerified] = verification.Ok.ToString();
            merged[AppRuntimeConfig.KeyLicenseStatus] = verification.Status ?? "verified";
            merged[AppRuntimeConfig.KeyLicenseVerifiedAt] = DateTimeOffset.UtcNow.ToString("O");
        }
        settings.UpdateAndSaveEnvFile(merged);

        await db.SaveChangesAsync();

        DialogResult = true;
        Close();
    }

    private async void TestLicenseKey_Click(object sender, RoutedEventArgs e)
    {
        LicenseStatusText.Text = "Testing license key with Whop...";
        var verifier = _sp.GetRequiredService<LicenseVerificationService>();
        var result = await verifier.VerifyAsync(LicenseKeyBox.Text.Trim());
        LicenseStatusText.Text = result.Message;
        MessageBox.Show(result.Message, "License verification", MessageBoxButton.OK,
            result.Ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }

    private void OpenLicenseResetHelp_Click(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = LicenseVerificationService.ResetLicenseHelpUrl,
            UseShellExecute = true
        });
    }

    private void OpenNinjaTrader_Click(object sender, RoutedEventArgs e)
    {
        _ = OpenNinjaTraderForDiscoveryAsync();
    }

    private async void ScanNinjaTrader_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var started = await OpenNinjaTraderForDiscoveryAsync();
            if (started)
                await Task.Delay(TimeSpan.FromSeconds(8));
            NinjaTraderScanStatusText.Text = "Scanning NinjaTrader Control Center with UI automation...";

            var result = await NinjaTraderUiDiscovery.ScanAsync(TimeSpan.FromSeconds(10));
            _discoveredPropConnections.Clear();
            foreach (var connection in result.Connections)
                _discoveredPropConnections.Add(connection);

            _discoveredAccounts.Clear();
            foreach (var account in result.Accounts)
                _discoveredAccounts.Add(account);

            SelectAll(DiscoveredPropConnectionsList);
            SelectAll(DiscoveredAccountsList);
            ApplyDiscoveredSelections();

            NinjaTraderScanStatusText.Text =
                $"Found {_discoveredPropConnections.Count} prop firm connection(s) and {_discoveredAccounts.Count} account(s). {result.Detail}";
        }
        catch (Exception ex)
        {
            NinjaTraderScanStatusText.Text = "NinjaTrader discovery failed: " + ex.Message;
            MessageBox.Show(NinjaTraderScanStatusText.Text, "NinjaTrader discovery", MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private async Task<bool> OpenNinjaTraderForDiscoveryAsync()
    {
        try
        {
            if (NinjaTraderUiDiscovery.IsNinjaTraderRunning())
            {
                NinjaTraderScanStatusText.Text = "NinjaTrader is already running. Scanning the Control Center now.";
                return false;
            }

            if (NinjaTraderAutoLoginCheck.IsChecked == true
                && !string.IsNullOrWhiteSpace(NinjaTraderUsernameBox.Text)
                && !string.IsNullOrWhiteSpace(NinjaTraderPasswordBox.Password))
            {
                SaveOptionalNinjaTraderLoginSettings();
                var message = await RunOptionalNinjaTraderLoginAsync();
                NinjaTraderScanStatusText.Text = message;
                return true;
            }

            var response = MessageBox.Show(
                "NinjaTrader login credentials were not entered. Open NinjaTrader now so you can log in manually before scanning prop firms and accounts?",
                "Open NinjaTrader",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);
            if (response != MessageBoxResult.Yes)
            {
                NinjaTraderScanStatusText.Text = "NinjaTrader was not opened. Enter optional credentials or open NinjaTrader manually before scanning.";
                return false;
            }

            var started = NinjaTraderUiDiscovery.EnsureNinjaTraderStarted();
            NinjaTraderScanStatusText.Text = started
                ? "NinjaTrader is starting. Log in if prompted, then click Scan Prop Firms and Accounts."
                : "NinjaTrader is already running. Click Scan Prop Firms and Accounts.";
            return started;
        }
        catch (Exception ex)
        {
            NinjaTraderScanStatusText.Text = "Could not open NinjaTrader: " + ex.Message;
            MessageBox.Show(NinjaTraderScanStatusText.Text, "NinjaTrader discovery", MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return false;
        }
    }

    private void SaveOptionalNinjaTraderLoginSettings()
    {
        var settings = _sp.GetRequiredService<AppSettingsProvider>();
        var merged = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase)
        {
            [AppRuntimeConfig.KeyNinjaTraderAutoLoginEnabled] = "true",
            [AppRuntimeConfig.KeyNinjaTraderLoginUsername] = NinjaTraderUsernameBox.Text.Trim(),
            [AppRuntimeConfig.KeyNinjaTraderLoginPasswordProtected] =
                WindowsProtectedSecret.Protect(NinjaTraderPasswordBox.Password)
        };
        settings.UpdateAndSaveEnvFile(merged);
    }

    private static async Task<string> RunOptionalNinjaTraderLoginAsync()
    {
        var script = FindOptionalNinjaTraderLoginScript();
        if (script is null)
            throw new FileNotFoundException("Optional NinjaTrader login script was not found.");

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        using var process = Process.Start(psi);
        if (process is null)
            throw new InvalidOperationException("Unable to start optional NinjaTrader login automation.");

        var output = await process.StandardOutput.ReadToEndAsync();
        var error = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(error)
                ? "Optional NinjaTrader login automation failed."
                : error.Trim());

        return string.IsNullOrWhiteSpace(output)
            ? "NinjaTrader login automation started."
            : output.Trim();
    }

    private static string? FindOptionalNinjaTraderLoginScript()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "scripts", "Start-NinjaTraderWithOptionalLogin.ps1"),
            Path.Combine(AppContext.BaseDirectory, "Start-NinjaTraderWithOptionalLogin.ps1"),
            @"C:\Users\Administrator\Desktop\vincere-ops\scripts\Start-NinjaTraderWithOptionalLogin.ps1"
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private void DiscoveredPropConnectionsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        ApplyDiscoveredSelections();
    }

    private void DiscoveredAccountsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        ApplyDiscoveredSelections();
    }

    private void ApplyDiscoveredSelections()
    {
        var connections = DiscoveredPropConnectionsList.SelectedItems.Cast<string>()
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (connections.Count > 0)
            PropConnBox.Text = string.Join("; ", connections);

        var accounts = DiscoveredAccountsList.SelectedItems.Cast<string>()
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (accounts.Count > 0)
            AccountsBox.Text = string.Join(Environment.NewLine, accounts);
    }

    private static void SelectAll(ListBox list)
    {
        list.SelectAll();
    }
}
