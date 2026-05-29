using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Win32;
using Vincere.Core.Data;
using Vincere.Core.Infrastructure;
using Vincere.Core.Services;
using Vincere.Ipc.Contract;

namespace Vincere.Operator;

public partial class MainWindow : Window
{
    private readonly IServiceProvider _sp;
    private readonly TradingBotOrchestrator _orchestrator;
    private readonly TelegramNotifier _telegram;
    private readonly AppRuntimeConfig _config;
    private readonly StackApplyService _stackApply;
    private readonly ExcelImportService _excel;
    private readonly NtLogHealthWatcher _logWatcher;
    private readonly NinjaTraderProcessService _ntProcess;
    private DateTimeOffset _lastNtHealthReconnectUtc = DateTimeOffset.MinValue;

    private readonly ObservableCollection<TradingAccountEntity> _accounts = new();
    private readonly ObservableCollection<StackRowVm> _stackRows = new();
    private readonly ObservableCollection<ExcelMapRow> _excelMap = new();
    private readonly ObservableCollection<string> _availablePropConnections = new();
    private readonly ObservableCollection<string> _availableNtAccounts = new();
    private readonly Dictionary<string, List<string>> _templatesByStrategy = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> _lastPropConnectRequestUtc = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<Guid> _lastBlueprintAccountIds = new();
    private bool _loadingStackAccount;

    /// <summary>Template dropdown: .env, *.xml under Documents\NinjaTrader 8\templates, saved stacks.</summary>
    public ObservableCollection<string> NtTemplateChoices { get; } = new();

    /// <summary>Period dropdown for each stack row.</summary>
    public ObservableCollection<PeriodChoiceItem> PeriodChoices { get; } = new();

    private List<ExcelImportService.ImportedRowDto> _lastExcelRows = new();

    public MainWindow(IServiceProvider sp)
    {
        _sp = sp;
        InitializeComponent();

        DataContext = this;

        PeriodChoices.Add(new PeriodChoiceItem { Label = "(none)", Value = "" });
        PeriodChoices.Add(new PeriodChoiceItem { Label = "Period 1", Value = "Period1" });
        PeriodChoices.Add(new PeriodChoiceItem { Label = "Period 2", Value = "Period2" });

        _orchestrator = sp.GetRequiredService<TradingBotOrchestrator>();
        _telegram = sp.GetRequiredService<TelegramNotifier>();
        _config = sp.GetRequiredService<AppRuntimeConfig>();
        _stackApply = sp.GetRequiredService<StackApplyService>();
        _excel = sp.GetRequiredService<ExcelImportService>();
        _logWatcher = sp.GetRequiredService<NtLogHealthWatcher>();
        _ntProcess = sp.GetRequiredService<NinjaTraderProcessService>();
        AccountList.ItemsSource = _accounts;
        StackGrid.ItemsSource = _stackRows;
        ExcelMappingItems.ItemsSource = _excelMap;
        AvailablePropConnectionsList.ItemsSource = _availablePropConnections;
        AvailableNtAccountsList.ItemsSource = _availableNtAccounts;

        Loaded += MainWindow_Loaded;
    }

    public sealed class PeriodChoiceItem
    {
        public string Label { get; init; } = "";
        public string Value { get; init; } = "";
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        PathsText.Text =
            $"Data: {AppPaths.RootDataDirectory}\nEnv: {AppPaths.EnvFilePath}\nDatabase: {AppPaths.DatabasePath}";
        DryRunText.Text = _config.DryRun
            ? "DRY_RUN is enabled — NinjaTrader commands are simulated where possible."
            : "";
        var showLicenseUi = _config.LicenseUiEnabled || _config.LicenseRequired;
        LicenseText.Visibility = showLicenseUi ? Visibility.Visible : Visibility.Collapsed;
        if (showLicenseUi)
        {
            LicenseText.Text = _config.LicenseVerified
                ? $"License: {_config.LicenseStatus ?? "verified"}"
                : "License: missing";
        }
        IpcHintText.Text =
            $"Pipe name: {_config.IpcPipeName}  |  {_config.IpcRetryAttempts} attempts × {_config.IpcConnectTimeoutMs} ms + {_config.IpcRetryDelayMs} ms pause\n" +
            $"DRY_RUN: {_config.DryRun} (set false in .env for real automation)\n" +
            $"PROP_CONNECTION_NAME: {(_config.PropConnectionName ?? "(unset)")}\n" +
            $"Get algos ready: {_config.ReadyAlgosScheduleEnabled} @ {_config.ReadyAlgosTime:HH:mm}\n" +
            $"Stack apply: {_config.AutoApplyStacks} @ {_config.StackApplyTime:HH:mm}; account cycling: {_config.AccountCyclingEnabled} every {_config.AccountCyclingIntervalDays} day(s)\n" +
            $"NT scheduled reset: {_config.NinjaTraderScheduledResetEnabled} every {_config.NinjaTraderResetIntervalDays} day(s)\n" +
            $"NT health auto-reconnect: {_config.NtHealthAutoReconnect} ({_config.NtHealthReconnectCooldownMinutes} min cooldown, {_config.NtHealthPollSeconds}s poll)\n" +
            "Setup and discovery use NinjaTrader UI automation. Bot control commands may still require the NT bridge until their UI paths are mapped.";
        LoadAutomationSettingsIntoDashboard();

        ApplyFilterCombo.Items.Clear();
        ApplyFilterCombo.Items.Add(new ComboBoxItem
            { Content = "All checked rows", Tag = StackApplyPeriodFilter.AllEnabled });
        ApplyFilterCombo.Items.Add(new ComboBoxItem
            { Content = "Period 1 only (checked rows)", Tag = StackApplyPeriodFilter.Period1Only });
        ApplyFilterCombo.Items.Add(new ComboBoxItem
            { Content = "Period 2 only (checked rows)", Tag = StackApplyPeriodFilter.Period2Only });
        ApplyFilterCombo.SelectedIndex = 0;

        await ReloadAccountsAsync();
        await RefreshNtTemplateChoicesAsync();

        StackAccountCombo.ItemsSource = _accounts;
        await SelectDefaultStackAccountAsync();
        BotStateText.Text = "Stopped";

        if (_config.ReadyAlgosScheduleEnabled)
            ArmManager($"Manager armed for Get Algos Ready @ {_config.ReadyAlgosTime:HH:mm} Eastern.", false);
    }

    private void LoadAutomationSettingsIntoDashboard()
    {
        PropFirmBox.Text = _config.PropFirm ?? "";
        AccountTypeBox.Text = _config.AccountType ?? "";
        PropConnectionNameBox.Text = _config.PropConnectionName ?? "";
        TradingPlatformBox.Text = string.IsNullOrWhiteSpace(_config.TradingPlatform)
            ? "NinjaTrader 8"
            : _config.TradingPlatform;
        NinjaTraderAutoLoginCheck.IsChecked = _config.NinjaTraderAutoLoginEnabled;
        NinjaTraderUsernameBox.Text = _config.NinjaTraderLoginUsername ?? "";
        NinjaTraderPasswordBox.Password = "";
        NinjaTraderScheduledResetCheck.IsChecked = _config.NinjaTraderScheduledResetEnabled;
        NinjaTraderResetDaysBox.Text = _config.NinjaTraderResetIntervalDays.ToString(CultureInfo.InvariantCulture);
        ReadyAlgosScheduleCheck.IsChecked = _config.ReadyAlgosScheduleEnabled;
        ReadyAlgosEnableStrategiesCheck.IsChecked = _config.ReadyAlgosEnableStrategies;
        ReadyAlgosTimeBox.Text = _config.ReadyAlgosTime.ToString("HH:mm", CultureInfo.InvariantCulture);
        ReadyAlgosStatusText.Text = _config.ReadyAlgosScheduleEnabled
            ? $"Get Algos Ready scheduled for {_config.ReadyAlgosTime:HH:mm} Eastern; strategies {(_config.ReadyAlgosEnableStrategies ? "will enable" : "stay disabled")}."
            : "Get Algos Ready schedule is off.";
        var showLicenseUi = _config.LicenseUiEnabled || _config.LicenseRequired;
        SettingsLicensePanel.Visibility = showLicenseUi ? Visibility.Visible : Visibility.Collapsed;
        if (showLicenseUi)
        {
            SettingsLicenseKeyBox.Text = _config.LicenseKey ?? "";
            SettingsLicenseStatusText.Text = _config.LicenseVerified
                ? $"License verified: {_config.LicenseStatus ?? "verified"}"
                : "License not verified.";
        }
    }

    private void SaveAutomationSettings_Click(object sender, RoutedEventArgs e)
    {
        if (TrySaveAutomationSettings())
            StatusText.Text = "Automation setup saved.";
    }

    private bool TrySaveAutomationSettings()
    {
        if (NinjaTraderAutoLoginCheck.IsChecked == true
            && string.IsNullOrWhiteSpace(NinjaTraderPasswordBox.Password)
            && string.IsNullOrWhiteSpace(_config.NinjaTraderLoginPasswordProtected))
        {
            MessageBox.Show(
                "NinjaTrader auto-login is optional. To enable it, enter the NinjaTrader password once so it can be encrypted for this Windows user.",
                "Optional NinjaTrader login",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return false;
        }

        if (!TryReadNinjaTraderResetIntervalDays(out var resetDays))
            return false;

        if (!TryReadReadyAlgosTime(out var readyAlgosTime))
            return false;

        var settings = _sp.GetRequiredService<AppSettingsProvider>();
        var merged = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase)
        {
            [AppRuntimeConfig.KeyPropFirm] = PropFirmBox.Text.Trim(),
            [AppRuntimeConfig.KeyAccountType] = AccountTypeBox.Text.Trim(),
            [AppRuntimeConfig.KeyPropConnectionName] = PropConnectionNameBox.Text.Trim(),
            [AppRuntimeConfig.KeyTradingPlatform] = string.IsNullOrWhiteSpace(TradingPlatformBox.Text)
                ? "NinjaTrader 8"
                : TradingPlatformBox.Text.Trim(),
            [AppRuntimeConfig.KeyNinjaTraderAutoLoginEnabled] =
                (NinjaTraderAutoLoginCheck.IsChecked == true).ToString(),
            [AppRuntimeConfig.KeyNinjaTraderLoginUsername] = NinjaTraderUsernameBox.Text.Trim(),
            [AppRuntimeConfig.KeyNinjaTraderScheduledResetEnabled] =
                (NinjaTraderScheduledResetCheck.IsChecked == true).ToString(),
            [AppRuntimeConfig.KeyNinjaTraderResetIntervalDays] =
                resetDays.ToString(CultureInfo.InvariantCulture),
            [AppRuntimeConfig.KeyReadyAlgosScheduleEnabled] =
                (ReadyAlgosScheduleCheck.IsChecked == true).ToString(),
            [AppRuntimeConfig.KeyReadyAlgosTime] =
                readyAlgosTime.ToString("HH:mm", CultureInfo.InvariantCulture),
            [AppRuntimeConfig.KeyReadyAlgosEnableStrategies] =
                (ReadyAlgosEnableStrategiesCheck.IsChecked == true).ToString(),
            [AppRuntimeConfig.KeyConnectionRefreshTime] =
                readyAlgosTime.ToString("HH:mm", CultureInfo.InvariantCulture),
            [AppRuntimeConfig.KeyStackApplyTime] =
                readyAlgosTime.ToString("HH:mm", CultureInfo.InvariantCulture),
            [AppRuntimeConfig.KeyEnableAllTime] =
                readyAlgosTime.ToString("HH:mm", CultureInfo.InvariantCulture),
            [AppRuntimeConfig.KeyAutoApplyStacks] = "true",
            [AppRuntimeConfig.KeyUseUiStrategyToggle] = "true"
        };

        if (!string.IsNullOrWhiteSpace(NinjaTraderPasswordBox.Password))
            merged[AppRuntimeConfig.KeyNinjaTraderLoginPasswordProtected] =
                WindowsProtectedSecret.Protect(NinjaTraderPasswordBox.Password);

        if ((_config.LicenseUiEnabled || _config.LicenseRequired) &&
            !string.Equals(SettingsLicenseKeyBox.Text.Trim(), _config.LicenseKey, StringComparison.Ordinal))
        {
            merged[AppRuntimeConfig.KeyLicenseKey] = SettingsLicenseKeyBox.Text.Trim();
            merged[AppRuntimeConfig.KeyLicenseVerified] = "false";
            merged[AppRuntimeConfig.KeyLicenseStatus] = "";
            merged[AppRuntimeConfig.KeyLicenseVerifiedAt] = "";
        }

        settings.UpdateAndSaveEnvFile(merged);
        if (ReadyAlgosScheduleCheck.IsChecked == true)
        {
            try
            {
                RegisterDailyStartupTasks(readyAlgosTime);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Settings were saved, but the Windows startup schedule could not be updated: " + ex.Message,
                    "Get Algos Ready schedule",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }
        }
        LoadAutomationSettingsIntoDashboard();
        return true;
    }

    private static void RegisterDailyStartupTasks(TimeOnly readyAlgosTime)
    {
        var script = FindPackagedScript("Register-VincereDailyTasks.ps1");
        if (string.IsNullOrWhiteSpace(script))
            throw new FileNotFoundException("Register-VincereDailyTasks.ps1 was not found.");

        var ninjaTime = readyAlgosTime.AddMinutes(-10).ToString("HH:mm", CultureInfo.InvariantCulture);
        var operatorTime = readyAlgosTime.AddMinutes(-5).ToString("HH:mm", CultureInfo.InvariantCulture);
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments =
                $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -NinjaTime \"{ninjaTime}\" -OperatorTime \"{operatorTime}\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("PowerShell failed to start.");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr);
    }

    private static string? FindPackagedScript(string name)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "scripts", name),
            Path.Combine(AppContext.BaseDirectory, name),
            Path.Combine(@"C:\Users\Administrator\Desktop\vincere-ops\scripts", name)
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    private async void VerifyLicense_Click(object sender, RoutedEventArgs e)
    {
        var licenseKey = SettingsLicenseKeyBox.Text.Trim();
        var verifier = _sp.GetRequiredService<LicenseVerificationService>();
        var result = await verifier.VerifyAsync(licenseKey);
        if (!result.Ok)
        {
            SettingsLicenseStatusText.Text = result.Message;
            MessageBox.Show(result.Message, "License verification", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var settings = _sp.GetRequiredService<AppSettingsProvider>();
        var merged = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase)
        {
            [AppRuntimeConfig.KeyLicenseKey] = licenseKey,
            [AppRuntimeConfig.KeyLicenseVerified] = "true",
            [AppRuntimeConfig.KeyLicenseStatus] = result.Status ?? "verified",
            [AppRuntimeConfig.KeyLicenseVerifiedAt] = DateTimeOffset.UtcNow.ToString("O")
        };
        settings.UpdateAndSaveEnvFile(merged);
        LoadAutomationSettingsIntoDashboard();
        if (_config.LicenseUiEnabled || _config.LicenseRequired)
            LicenseText.Text = $"License: {result.Status ?? "verified"}";
        StatusText.Text = "License verified.";
    }

    private void OpenLicenseResetHelp_Click(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = LicenseVerificationService.ResetLicenseHelpUrl,
            UseShellExecute = true
        });
    }

    private void OpenAccountCyclingBlueprint_Click(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "https://www.vinceretrading.com/accountcycling",
            UseShellExecute = true
        });
    }

    private void OpenLogs_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.LogsDirectory);
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = $"\"{AppPaths.LogsDirectory}\"",
                UseShellExecute = true
            });
            StatusText.Text = $"Opened logs: {AppPaths.LogsDirectory}";
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Could not open the logs folder: " + ex.Message,
                "Open logs",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private void ShowSettings_Click(object sender, RoutedEventArgs e)
    {
        foreach (var item in MainTabs.Items)
        {
            if (item is TabItem tab &&
                string.Equals(tab.Header?.ToString(), "Settings", StringComparison.OrdinalIgnoreCase))
            {
                MainTabs.SelectedItem = tab;
                return;
            }
        }
    }

    private void SavePropFirmSettings_Click(object sender, RoutedEventArgs e)
    {
        SaveAutomationSettings_Click(sender, e);
    }

    private async void TestNinjaTraderLogin_Click(object sender, RoutedEventArgs e)
    {
        if (!TrySaveAutomationSettings())
            return;
        StatusText.Text = "Launching NinjaTrader...";
        StatusText.Text = await _ntProcess.LaunchAsync();
    }

    private bool TryReadNinjaTraderResetIntervalDays(out int resetDays)
    {
        if (int.TryParse(NinjaTraderResetDaysBox.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture,
                out resetDays)
            && resetDays >= 1
            && resetDays <= 90)
        {
            return true;
        }

        MessageBox.Show(
            "NinjaTrader reset interval must be a whole number from 1 to 90 days.",
            "NinjaTrader reset schedule",
            MessageBoxButton.OK,
            MessageBoxImage.Warning);
        NinjaTraderResetDaysBox.Focus();
        return false;
    }

    private bool TryReadReadyAlgosTime(out TimeOnly readyTime)
    {
        if (TimeOnly.TryParse(ReadyAlgosTimeBox.Text.Trim(), CultureInfo.InvariantCulture, out readyTime))
            return true;

        MessageBox.Show(
            "Get Algos Ready time must be HH:mm, for example 08:00.",
            "Get Algos Ready schedule",
            MessageBoxButton.OK,
            MessageBoxImage.Warning);
        ReadyAlgosTimeBox.Focus();
        return false;
    }

    private static bool ValidateTimeBox(TextBox box, string label)
    {
        if (string.IsNullOrWhiteSpace(box.Text))
            return true;
        if (TimeOnly.TryParse(box.Text.Trim(), out _))
            return true;
        MessageBox.Show($"{label} must be HH:mm, for example 16:55.", "Validation", MessageBoxButton.OK,
            MessageBoxImage.Warning);
        box.Focus();
        return false;
    }

    private StackApplyPeriodFilter SelectedApplyPeriodFilter =>
        ApplyFilterCombo.SelectedItem is ComboBoxItem i && i.Tag is StackApplyPeriodFilter f
            ? f
            : StackApplyPeriodFilter.AllEnabled;

    private async Task RefreshNtTemplateChoicesAsync()
    {
        var merged = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var byStrategy = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in _config.NtTemplateChoiceList)
            merged.Add(x);

        try
        {
            var disco = _sp.GetRequiredService<NinjaTraderTemplateDiscoveryService>();
            foreach (var template in disco.DiscoverXmlTemplates(_config))
            {
                merged.Add(template.TemplateName);
                if (!string.IsNullOrWhiteSpace(template.StrategyName))
                    AddTemplateForStrategy(byStrategy, template.StrategyName, template.TemplateName);
            }
        }
        catch
        {
            /* disk scan optional */
        }

        try
        {
            var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
            await using var db = await dbf.CreateDbContextAsync();
            var tpls = await db.StackStrategies.AsNoTracking()
                .Select(s => new { s.StrategyTypeName, s.TemplateName })
                .Where(t => !string.IsNullOrWhiteSpace(t.TemplateName))
                .Distinct()
                .ToListAsync();
            foreach (var t in tpls)
            {
                merged.Add(t.TemplateName);
                if (!string.IsNullOrWhiteSpace(t.StrategyTypeName))
                    AddTemplateForStrategy(byStrategy, t.StrategyTypeName, t.TemplateName);
            }
        }
        catch
        {
            /* ignore template refresh if DB busy */
        }

        NtTemplateChoices.Clear();
        foreach (var x in merged.OrderBy(s => s))
            NtTemplateChoices.Add(x);

        _templatesByStrategy.Clear();
        foreach (var pair in byStrategy)
        {
            _templatesByStrategy[pair.Key] = pair.Value
                .OrderBy(s => s, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
    }

    private static void AddTemplateForStrategy(
        IDictionary<string, HashSet<string>> map,
        string strategyName,
        string templateName)
    {
        if (string.IsNullOrWhiteSpace(strategyName) || string.IsNullOrWhiteSpace(templateName))
            return;

        var key = strategyName.Trim();
        if (!map.TryGetValue(key, out var values))
        {
            values = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            map[key] = values;
        }

        values.Add(templateName.Trim());
    }

    private void TemplateCombo_DropDownOpened(object sender, EventArgs e)
    {
        if (sender is not ComboBox combo || combo.DataContext is not StackRowVm row)
            return;

        combo.ItemsSource = GetTemplateChoicesForStrategy(row.StrategyTypeName, row.TemplateName);
    }

    private IReadOnlyList<string> GetTemplateChoicesForStrategy(string strategyTypeName, string currentTemplateName)
    {
        var choices = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in ResolveTemplateStrategyKeys(strategyTypeName))
        {
            if (_templatesByStrategy.TryGetValue(key, out var templates))
            {
                foreach (var template in templates)
                    choices.Add(template);
            }
        }

        if (choices.Count == 0 && !string.IsNullOrWhiteSpace(strategyTypeName))
        {
            var strategyKey = NormalizeTemplateKey(strategyTypeName);
            foreach (var template in NtTemplateChoices)
            {
                if (NormalizeTemplateKey(template).Contains(strategyKey, StringComparison.OrdinalIgnoreCase))
                    choices.Add(template);
            }
        }

        if (!string.IsNullOrWhiteSpace(currentTemplateName))
            choices.Add(currentTemplateName.Trim());

        if (choices.Count == 0 && string.IsNullOrWhiteSpace(strategyTypeName))
        {
            foreach (var template in NtTemplateChoices)
                choices.Add(template);
        }

        return choices.ToArray();
    }

    private ExcelImportService.ImportedRowDto PrepareBlueprintRow(ExcelImportService.ImportedRowDto row)
    {
        var period = string.IsNullOrWhiteSpace(row.TradingPeriod) ? "Period1" : row.TradingPeriod;
        var instrument = ExcelImportService.ResolveInstrumentForStrategy(row.StrategyType, row.Instrument);
        var template = string.IsNullOrWhiteSpace(row.TemplateName)
            ? ResolveDefaultLowRiskTemplate(row.StrategyType, period)
            : row.TemplateName.Trim();

        return row with
        {
            TradingPeriod = period,
            Instrument = instrument,
            TemplateName = template
        };
    }

    private string ResolveDefaultLowRiskTemplate(string strategyTypeName, string tradingPeriod)
    {
        var templatePeriod = string.Equals(tradingPeriod, "Period2", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        var periodToken = $"Period {templatePeriod}";
        var choices = GetTemplateChoicesForStrategy(strategyTypeName, "")
            .Concat(NtTemplateChoices)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var match = choices
            .Where(x => IsLowRiskV1PeriodTemplate(x, periodToken))
            .OrderBy(x => !TemplateLooksLikeStrategy(x, strategyTypeName))
            .ThenBy(x => x.Length)
            .FirstOrDefault();

        if (!string.IsNullOrWhiteSpace(match))
            return match;

        var prefix = DefaultTemplateStrategyPrefix(strategyTypeName);
        return string.IsNullOrWhiteSpace(prefix)
            ? $"Low Risk - v1 - {periodToken}"
            : $"{prefix} - Low Risk - v1 - {periodToken}";
    }

    private static bool IsLowRiskV1PeriodTemplate(string templateName, string periodToken)
    {
        var normalized = NormalizeTemplateKey(templateName);
        return normalized.Contains("LOWRISK", StringComparison.OrdinalIgnoreCase)
               && Regex.IsMatch(templateName, @"\bv\s*1\b", RegexOptions.IgnoreCase)
               && normalized.Contains(NormalizeTemplateKey(periodToken), StringComparison.OrdinalIgnoreCase);
    }

    private static bool TemplateLooksLikeStrategy(string templateName, string strategyTypeName)
    {
        var strategy = DefaultTemplateStrategyPrefix(strategyTypeName);
        return !string.IsNullOrWhiteSpace(strategy) &&
               NormalizeTemplateKey(templateName).Contains(NormalizeTemplateKey(strategy), StringComparison.OrdinalIgnoreCase);
    }

    private static string DefaultTemplateStrategyPrefix(string strategyTypeName)
    {
        if (string.IsNullOrWhiteSpace(strategyTypeName))
            return "";

        var match = Regex.Match(strategyTypeName.Trim(), "^[A-Za-z]+");
        return match.Success ? match.Value.ToUpperInvariant() : "";
    }

    private IReadOnlyList<string> ResolveTemplateStrategyKeys(string strategyTypeName)
    {
        if (string.IsNullOrWhiteSpace(strategyTypeName))
            return Array.Empty<string>();

        var normalizedStrategy = NormalizeTemplateKey(strategyTypeName);
        if (string.IsNullOrWhiteSpace(normalizedStrategy))
            return Array.Empty<string>();

        var matches = _templatesByStrategy.Keys
            .Select(key => new { Key = key, Normalized = NormalizeTemplateKey(key) })
            .Where(x => x.Normalized.Length > 0 &&
                        (normalizedStrategy.Equals(x.Normalized, StringComparison.OrdinalIgnoreCase) ||
                         normalizedStrategy.StartsWith(x.Normalized, StringComparison.OrdinalIgnoreCase) ||
                         x.Normalized.StartsWith(normalizedStrategy, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (matches.Count == 0)
            return Array.Empty<string>();

        var bestLength = matches.Max(x => x.Normalized.Length);
        return matches
            .Where(x => x.Normalized.Length == bestLength)
            .Select(x => x.Key)
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string NormalizeTemplateKey(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";

        var chars = value
            .Where(char.IsLetterOrDigit)
            .Select(char.ToUpperInvariant)
            .ToArray();
        return new string(chars);
    }

    private async void RefreshNtTemplates_Click(object sender, RoutedEventArgs e)
    {
        await RefreshNtTemplateChoicesAsync();
        StatusText.Text =
            "Template list refreshed and grouped by selected algo.";
    }

    private void TemplateInfo_Click(object sender, RoutedEventArgs e)
    {
        MessageBox.Show(
            "Blueprint imports default missing templates to Low Risk v1. Period 1 maps to template Period 0; Period 2 maps to template Period 1. If a client chooses v1-v5 manually, keep the same version for the same algo on the same prop firm.",
            "Template version guidance",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    private async Task ReloadAccountsAsync()
    {
        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var list = (await db.Accounts.AsNoTracking().OrderBy(a => a.DisplayName).ToListAsync())
            .GroupBy(a => NormalizeAccountKey(a.RawAccountNumber))
            .Select(g => g.First())
            .ToList();
        _accounts.Clear();
        foreach (var a in list)
            _accounts.Add(a);

        if (_accounts.Count > 0 && AccountList.SelectedItem is not TradingAccountEntity)
            AccountList.SelectedItem = _accounts[0];
    }

    private async Task<List<TradingAccountEntity>> RefreshAccountsFromNinjaTraderUiAsync(
        NinjaTraderUiScanResult? scanResult = null,
        TimeSpan? timeout = null)
    {
        scanResult ??= await NinjaTraderUiDiscovery.ScanAsync(timeout ?? TimeSpan.FromSeconds(12));

        var currentAccounts = scanResult.Accounts
            .Select(CleanAccountName)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .GroupBy(NormalizeAccountKey)
            .Select(g => g.First())
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (currentAccounts.Count == 0)
            return new List<TradingAccountEntity>();

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var existing = await db.Accounts.ToListAsync();
        var existingByKey = existing
            .Select(a => new { Account = a, Key = NormalizeAccountKey(a.RawAccountNumber) })
            .Where(x => !string.IsNullOrWhiteSpace(x.Key))
            .GroupBy(x => x.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Account, StringComparer.OrdinalIgnoreCase);

        foreach (var account in currentAccounts)
        {
            var key = NormalizeAccountKey(account);
            if (string.IsNullOrWhiteSpace(key))
                continue;

            if (existingByKey.TryGetValue(key, out var existingAccount))
            {
                existingAccount.RawAccountNumber = account;
                existingAccount.DisplayName = account;
                continue;
            }

            var entity = new TradingAccountEntity
            {
                Id = Guid.NewGuid(),
                RawAccountNumber = account,
                DisplayName = account
            };
            db.Accounts.Add(entity);
            existingByKey[key] = entity;
        }

        await db.SaveChangesAsync();

        var currentKeys = currentAccounts
            .Select(NormalizeAccountKey)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return (await db.Accounts.AsNoTracking().OrderBy(a => a.DisplayName).ToListAsync())
            .Where(a => currentKeys.Contains(NormalizeAccountKey(a.RawAccountNumber)))
            .GroupBy(a => NormalizeAccountKey(a.RawAccountNumber))
            .Select(g => g.First())
            .ToList();
    }

    private async Task SelectDefaultStackAccountAsync()
    {
        if (_accounts.Count == 0 || StackAccountCombo.SelectedItem is TradingAccountEntity)
            return;

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var accountIdsWithRows = await db.StackStrategies.AsNoTracking()
            .Select(s => s.AccountId)
            .Distinct()
            .ToListAsync();

        var accountIds = accountIdsWithRows.ToHashSet();
        StackAccountCombo.SelectedItem = _accounts.FirstOrDefault(a => accountIds.Contains(a.Id)) ?? _accounts[0];
        await LoadStackForSelectedAccountAsync();
    }

    private void StartBot_Click(object sender, RoutedEventArgs e)
    {
        ArmManager("Bot armed (Mon-Fri Eastern schedule)", true);
    }

    private void ArmManager(string status, bool notify)
    {
        _orchestrator.Start();
        _logWatcher.Alert -= OnLogAlert;
        _logWatcher.Alert += OnLogAlert;
        _logWatcher.Start();
        StartBotBtn.IsEnabled = false;
        StopBotBtn.IsEnabled = true;
        BotStateText.Text = "Running";
        StatusText.Text = status;
        ReadyAlgosStatusText.Text = _config.ReadyAlgosScheduleEnabled
            ? $"Get Algos Ready scheduled for {_config.ReadyAlgosTime:HH:mm} Eastern; strategies {(_config.ReadyAlgosEnableStrategies ? "will enable" : "stay disabled")}."
            : "Get Algos Ready schedule is off.";
        if (notify)
            _ = _telegram.SendAsync("Vincere Ops: bot started.");
    }

    private void StopBot_Click(object sender, RoutedEventArgs e)
    {
        _orchestrator.Stop();
        _logWatcher.Alert -= OnLogAlert;
        _logWatcher.Stop();
        StartBotBtn.IsEnabled = true;
        StopBotBtn.IsEnabled = false;
        BotStateText.Text = "Stopped";
        StatusText.Text = "Stopped";
        _ = _telegram.SendAsync("Vincere Ops: bot stopped.");
    }

    private async void GetAlgosReady_Click(object sender, RoutedEventArgs e)
    {
        var confirm = MessageBox.Show(
            _config.ReadyAlgosEnableStrategies
                ? "Get algos ready now? This disconnects and reconnects selected prop firms, applies the active saved stack, then enables strategies."
                : "Get algos ready now? This disconnects and reconnects selected prop firms and applies the active saved stack. Strategies will stay disabled.",
            "Get Algos Ready",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);
        if (confirm != MessageBoxResult.Yes)
            return;

        StatusText.Text = "Getting algos ready...";
        ReadyAlgosStatusText.Text = StatusText.Text;
        try
        {
            var message = await _orchestrator.RunGetAlgosReadyNowAsync();
            StatusText.Text = message;
            ReadyAlgosStatusText.Text = message;
            MessageBox.Show(message, "Get Algos Ready", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            StatusText.Text = "Get Algos Ready failed: " + ex.Message;
            ReadyAlgosStatusText.Text = StatusText.Text;
            MessageBox.Show(StatusText.Text, "Get Algos Ready", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void OnLogAlert(object? sender, NtHealthAlertEventArgs alert)
    {
        var msg = alert.ToString();
        Dispatcher.Invoke(() => StatusText.Text = msg);
        _ = _telegram.SendAsync("Vincere Ops alert: " + msg);

        if (!_config.NtHealthAutoReconnect)
            return;

        var connections = SplitConnectionNames(_config.PropConnectionName);
        if (connections.Count == 0)
        {
            _ = _telegram.SendAsync("Vincere Ops: NT health reconnect skipped because PROP_CONNECTION_NAME is unset.");
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var cooldown = TimeSpan.FromMinutes(_config.NtHealthReconnectCooldownMinutes);
        if (now - _lastNtHealthReconnectUtc < cooldown)
        {
            var remaining = cooldown - (now - _lastNtHealthReconnectUtc);
            _ = _telegram.SendAsync(
                $"Vincere Ops: NT health reconnect suppressed for {remaining.TotalMinutes:0.0} more minute(s): {alert.Reason}");
            return;
        }

        _lastNtHealthReconnectUtc = now;
        Dispatcher.Invoke(() => StatusText.Text =
            $"NT health alert: refreshing {string.Join(", ", connections)} ({alert.Reason})");

        try
        {
            var bridge = _sp.GetRequiredService<INinjaTraderBridge>();
            var results = new List<string>();
            foreach (var conn in connections)
            {
                var payload = JsonSerializer.SerializeToElement(new
                {
                    connectionName = conn,
                    reason = alert.Reason,
                    source = "nt-log-health-watcher",
                    logFile = alert.LogFileName
                });
                var res = await bridge.SendAsync(new IpcRequest
                {
                    Command = IpcCommands.RefreshConnection,
                    Payload = payload
                });
                results.Add($"{conn}: {(res?.Ok == true ? "OK" : res?.Message ?? "no response")}");
            }

            var result = string.Join(" | ", results);
            Dispatcher.Invoke(() => StatusText.Text = $"NT health reconnect: {result}");
            await _telegram.SendAsync($"Vincere Ops: auto refresh: {result}");
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() => StatusText.Text = "NT health reconnect failed: " + ex.Message);
            await _telegram.SendAsync("Vincere Ops: NT health reconnect failed: " + ex.Message);
        }
    }

    private async void Ping_Click(object sender, RoutedEventArgs e)
    {
        var bridge = _sp.GetRequiredService<INinjaTraderBridge>();
        var res = await bridge.SendAsync(new IpcRequest { Command = IpcCommands.Ping });
        var detail = res?.Message ?? "";
        PingResult.Text = res == null
            ? "No response."
            : res.Ok
                ? string.IsNullOrWhiteSpace(detail) ? "OK" : $"OK ({detail})"
                : string.IsNullOrWhiteSpace(detail) ? "Failed (no detail)." : detail;
    }

    private async void LaunchNinjaTrader_Click(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Launching NinjaTrader...";
        PingResult.Text = StatusText.Text;
        var message = await _ntProcess.LaunchAsync();
        StatusText.Text = message;
        PingResult.Text = message;
    }

    private async void ShutdownNinjaTrader_Click(object sender, RoutedEventArgs e)
    {
        var result = MessageBox.Show(
            "Shut down NinjaTrader now?",
            "Shut Down NinjaTrader",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);
        if (result != MessageBoxResult.Yes)
            return;

        StatusText.Text = "Shutting down NinjaTrader...";
        PingResult.Text = StatusText.Text;
        var message = await _ntProcess.ShutdownAsync();
        StatusText.Text = message;
        PingResult.Text = message;
    }

    private async void ConnectPropFirms_Click(object sender, RoutedEventArgs e)
    {
        await SendPropConnectionCommandAsync(IpcCommands.ConnectConnection, "Connect prop firms");
    }

    private async void DisconnectPropFirms_Click(object sender, RoutedEventArgs e)
    {
        await SendPropConnectionCommandAsync(IpcCommands.DisconnectConnection, "Disconnect prop firms");
    }

    private async void EnableAlgos_Click(object sender, RoutedEventArgs e)
    {
        await SetAllAlgosEnabledAsync(true);
    }

    private async void DisableAlgos_Click(object sender, RoutedEventArgs e)
    {
        await SetAllAlgosEnabledAsync(false);
    }

    private async Task SetAllAlgosEnabledAsync(bool enabled)
    {
        var label = enabled ? "Enable algos" : "Disable algos";
        var previousStatus = StatusText.Text;
        var previousPing = PingResult.Text;
        StatusText.Text = $"{label}: scanning NinjaTrader Strategies tab...";
        PingResult.Text = StatusText.Text;

        try
        {
            var result = await NinjaTraderUiDiscovery.SetAllStrategiesEnabledAsync(enabled, TimeSpan.FromSeconds(18));
            var text = result.Ok
                ? $"{label}: {result.Message}"
                : $"{label}: {result.Message}";
            StatusText.Text = text;
            PingResult.Text = text;
        }
        catch (Exception ex)
        {
            StatusText.Text = previousStatus;
            PingResult.Text = previousPing;
            MessageBox.Show($"{label} failed: {ex.Message}", label, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void ScanNinjaTraderSettings_Click(object sender, RoutedEventArgs e)
    {
        SettingsScanStatusText.Text = "Scanning NinjaTrader with UI automation...";

        var uiScan = await NinjaTraderUiDiscovery.ScanAsync();
        var connections = new SortedSet<string>(uiScan.Connections, StringComparer.OrdinalIgnoreCase);
        var accounts = new SortedSet<string>(uiScan.Accounts, StringComparer.OrdinalIgnoreCase);
        var details = new List<string> { uiScan.Detail };

        _availablePropConnections.Clear();
        foreach (var item in connections)
            _availablePropConnections.Add(item);

        _availableNtAccounts.Clear();
        foreach (var item in accounts)
            _availableNtAccounts.Add(item);

        var syncedAccounts = await RefreshAccountsFromNinjaTraderUiAsync(uiScan);
        if (syncedAccounts.Count > 0)
            await ReloadAccountsAsync();

        SelectExistingConnections();
        SettingsScanStatusText.Text =
            $"Found {_availablePropConnections.Count} connection(s) and {_availableNtAccounts.Count} account(s) using UI automation. Synced {syncedAccounts.Count} current account(s). {string.Join(" ", details)}";
        StatusText.Text = SettingsScanStatusText.Text;
    }

    private static async Task<NinjaTraderUiScanResult> ScanNinjaTraderUiControlsAsync()
    {
        var tcs = new TaskCompletionSource<NinjaTraderUiScanResult>();
        var thread = new Thread(() =>
        {
            try
            {
                tcs.SetResult(ScanNinjaTraderUiControls());
            }
            catch (Exception ex)
            {
                tcs.SetResult(new NinjaTraderUiScanResult(new List<string>(), new List<string>(),
                    $"UI scan failed: {ex.Message}"));
            }
        })
        {
            IsBackground = true,
            Name = "NinjaTrader UI scan"
        };

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        try
        {
            return await tcs.Task.WaitAsync(TimeSpan.FromSeconds(15));
        }
        catch (TimeoutException)
        {
            return new NinjaTraderUiScanResult(new List<string>(), new List<string>(),
                "NinjaTrader UI scan timed out.");
        }
    }

    private static NinjaTraderUiScanResult ScanNinjaTraderUiControls()
    {
        var connections = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var accounts = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var sawControlCenterXml = false;
        var sawControlCenter = false;
        var selectedAccountsTab = false;
        var openedConnectionsMenu = false;

        try
        {
            var desktop = AutomationElement.RootElement;
            foreach (var process in Process.GetProcessesByName("NinjaTrader"))
            {
                var processCondition = new PropertyCondition(AutomationElement.ProcessIdProperty, process.Id);
                var windows = desktop.FindAll(
                    TreeScope.Children,
                    processCondition);

                for (var i = 0; i < windows.Count; i++)
                {
                    var window = windows[i];
                    ScanNinjaTraderElement(window, connections, accounts, ref sawControlCenterXml);
                }

                var controlCenter = FindControlCenter(desktop, processCondition);
                if (controlCenter is null)
                    continue;

                sawControlCenter = true;
                ScanNinjaTraderElement(controlCenter, connections, accounts, ref sawControlCenterXml);

                if (TrySelectNinjaTraderTab(controlCenter, "AccountsGridTabItem"))
                {
                    selectedAccountsTab = true;
                    Thread.Sleep(500);
                    ScanNinjaTraderElement(controlCenter, connections, accounts, ref sawControlCenterXml);
                    ScanScrollableNinjaTraderElements(controlCenter, connections, accounts, ref sawControlCenterXml);
                }

                if (TryOpenConnectionsMenu(controlCenter))
                {
                    openedConnectionsMenu = true;
                    Thread.Sleep(500);
                    var popups = desktop.FindAll(TreeScope.Descendants, processCondition);
                    for (var j = 0; j < popups.Count; j++)
                        ScanNinjaTraderElement(popups[j], connections, accounts, ref sawControlCenterXml, maxDepth: 4);
                }
            }
        }
        catch
        {
            return new NinjaTraderUiScanResult(connections.ToList(), accounts.ToList(),
                "UI scan was blocked by Windows desktop automation.");
        }

        var detail = sawControlCenter
            ? "Read NinjaTrader Control Center UI controls."
            : "NinjaTrader Control Center UI controls were not visible.";
        if (sawControlCenterXml)
            detail += " Read connection XML exposed by Control Center.";
        if (selectedAccountsTab)
            detail += " Selected Accounts tab before scanning account rows.";
        if (openedConnectionsMenu)
            detail += " Opened Connections menu before scanning connection names.";
        if (accounts.Count == 0)
            detail += " Control Center did not expose account rows.";

        return new NinjaTraderUiScanResult(connections.ToList(), accounts.ToList(), detail);
    }

    private static AutomationElement? FindControlCenter(AutomationElement desktop, PropertyCondition processCondition)
    {
        var descendants = desktop.FindAll(TreeScope.Descendants, processCondition);
        for (var i = 0; i < descendants.Count; i++)
        {
            var element = descendants[i];
            if (GetElementAutomationId(element).Equals("ControlCenter", StringComparison.OrdinalIgnoreCase) ||
                GetElementClassName(element).Equals("ControlCenter", StringComparison.OrdinalIgnoreCase))
                return element;
        }

        return null;
    }

    private static bool TrySelectNinjaTraderTab(AutomationElement root, string automationId)
    {
        try
        {
            var tab = root.FindFirst(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));
            if (tab is null)
                return false;

            if (tab.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selectionPattern) &&
                selectionPattern is SelectionItemPattern selectionItem)
            {
                selectionItem.Select();
                return true;
            }

            if (tab.TryGetCurrentPattern(InvokePattern.Pattern, out var invokePattern) &&
                invokePattern is InvokePattern invoke)
            {
                invoke.Invoke();
                return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static bool TryOpenConnectionsMenu(AutomationElement controlCenter)
    {
        try
        {
            var menu = controlCenter.FindFirst(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.AutomationIdProperty, "ControlCenterMenuItemConnections"));
            if (menu is null)
                return false;

            if (menu.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var expandPattern) &&
                expandPattern is ExpandCollapsePattern expand)
            {
                expand.Expand();
                return true;
            }

            if (menu.TryGetCurrentPattern(InvokePattern.Pattern, out var invokePattern) &&
                invokePattern is InvokePattern invoke)
            {
                invoke.Invoke();
                return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static void ScanScrollableNinjaTraderElements(
        AutomationElement root,
        ISet<string> connections,
        ISet<string> accounts,
        ref bool sawControlCenterXml)
    {
        AutomationElementCollection elements;
        try
        {
            elements = root.FindAll(TreeScope.Descendants, System.Windows.Automation.Condition.TrueCondition);
        }
        catch
        {
            return;
        }

        for (var i = 0; i < elements.Count; i++)
        {
            var element = elements[i];
            try
            {
                if (!element.TryGetCurrentPattern(ScrollPattern.Pattern, out var pattern) ||
                    pattern is not ScrollPattern scroll ||
                    !scroll.Current.VerticallyScrollable)
                    continue;

                try
                {
                    scroll.SetScrollPercent(ScrollPattern.NoScroll, 0);
                    Thread.Sleep(150);
                }
                catch
                {
                    // Some NinjaTrader grids expose ScrollPattern but refuse direct percent setting.
                }

                var previous = double.NaN;
                for (var n = 0; n < 40; n++)
                {
                    ScanNinjaTraderElement(root, connections, accounts, ref sawControlCenterXml);
                    var current = scroll.Current.VerticalScrollPercent;
                    if (!double.IsNaN(previous) && Math.Abs(current - previous) < 0.01)
                        break;
                    previous = current;
                    scroll.Scroll(ScrollAmount.NoAmount, ScrollAmount.LargeIncrement);
                    Thread.Sleep(150);
                }
            }
            catch
            {
                // Scrolling is a best-effort discovery enhancement; one bad control should not stop scanning.
            }
        }
    }

    private static void ScanNinjaTraderElement(
        AutomationElement element,
        ISet<string> connections,
        ISet<string> accounts,
        ref bool sawControlCenterXml,
        int depth = 0,
        int maxDepth = 10)
    {
        if (depth > maxDepth)
            return;

        TryScanNinjaTraderUiText(GetElementName(element), connections, accounts, ref sawControlCenterXml);
        TryScanNinjaTraderUiText(GetElementValue(element), connections, accounts, ref sawControlCenterXml);

        AutomationElementCollection children;
        try
        {
            children = element.FindAll(TreeScope.Children, System.Windows.Automation.Condition.TrueCondition);
        }
        catch
        {
            return;
        }

        for (var i = 0; i < children.Count; i++)
            ScanNinjaTraderElement(children[i], connections, accounts, ref sawControlCenterXml, depth + 1, maxDepth);
    }

    private static void TryScanNinjaTraderUiText(
        string value,
        ISet<string> connections,
        ISet<string> accounts,
        ref bool sawControlCenterXml)
    {
        if (string.IsNullOrWhiteSpace(value))
            return;

        if (value.Contains("<NinjaTrader>", StringComparison.OrdinalIgnoreCase))
        {
            sawControlCenterXml = true;
            TryReadControlCenterXml(value, connections);
        }

        foreach (Match match in Regex.Matches(value, @"\b(?:[A-Z]{2,5}\d{6,}|Sim\d{2,4}|Playback\d{2,4}|Backtest)\b", RegexOptions.IgnoreCase))
            accounts.Add(match.Value.Trim());
    }

    private static void TryReadControlCenterXml(string xml, ISet<string> connections)
    {
        try
        {
            var document = XDocument.Parse(xml);
            foreach (var name in document.Descendants("Connection").Elements("Name"))
            {
                var value = name.Value.Trim();
                if (!string.IsNullOrWhiteSpace(value))
                    connections.Add(value);
            }
        }
        catch
        {
            // The Control Center value is an optional UI hint; malformed/partial XML should not break the scan.
        }
    }

    private static string GetElementName(AutomationElement element)
    {
        try
        {
            return element.Current.Name ?? "";
        }
        catch
        {
            return "";
        }
    }

    private static string GetElementAutomationId(AutomationElement element)
    {
        try
        {
            return element.Current.AutomationId ?? "";
        }
        catch
        {
            return "";
        }
    }

    private static string GetElementClassName(AutomationElement element)
    {
        try
        {
            return element.Current.ClassName ?? "";
        }
        catch
        {
            return "";
        }
    }

    private static string GetElementValue(AutomationElement element)
    {
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern) &&
                pattern is ValuePattern valuePattern)
                return valuePattern.Current.Value ?? "";
        }
        catch
        {
            return "";
        }

        return "";
    }

    private void UseSelectedConnections_Click(object sender, RoutedEventArgs e)
    {
        var selected = AvailablePropConnectionsList.SelectedItems.Cast<string>()
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (selected.Count == 0)
        {
            MessageBox.Show("Select at least one prop firm connection.", "Settings", MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        PropConnectionNameBox.Text = string.Join("; ", selected);
        StatusText.Text = "Selected prop firm connection(s) updated. Save settings to persist.";
    }

    private async void ImportSelectedNtAccounts_Click(object sender, RoutedEventArgs e)
    {
        var selected = AvailableNtAccountsList.SelectedItems.Cast<string>()
            .Select(CleanAccountName)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .GroupBy(NormalizeAccountKey)
            .Select(g => g.First())
            .ToList();

        if (selected.Count == 0)
        {
            MessageBox.Show("Select at least one account.", "Settings", MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var existing = await db.Accounts.ToListAsync();
        var existingKeys = existing
            .Select(a => NormalizeAccountKey(a.RawAccountNumber))
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = 0;

        foreach (var account in selected)
        {
            var cleanAccount = CleanAccountName(account);
            var key = NormalizeAccountKey(cleanAccount);
            if (string.IsNullOrWhiteSpace(key) || existingKeys.Contains(key))
                continue;

            db.Accounts.Add(new TradingAccountEntity
            {
                Id = Guid.NewGuid(),
                RawAccountNumber = cleanAccount,
                DisplayName = cleanAccount
            });
            existingKeys.Add(key);
            added++;
        }

        await db.SaveChangesAsync();
        await ReloadAccountsAsync();
        StatusText.Text = added == 0
            ? "Selected accounts already exist locally."
            : $"Imported {added} account(s) from NinjaTrader.";
    }

    private async Task SendPropConnectionCommandAsync(string command, string label)
    {
        var names = SplitConnectionNames(PropConnectionNameBox.Text);
        if (names.Count == 0)
            names = SplitConnectionNames(_config.PropConnectionName);

        if (names.Count == 0)
        {
            MessageBox.Show("Set the prop connection name first.", label, MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var bridge = _sp.GetRequiredService<INinjaTraderBridge>();
        var results = new List<string>();
        foreach (var name in names)
        {
            var isConnectCommand = string.Equals(command, IpcCommands.ConnectConnection, StringComparison.OrdinalIgnoreCase);
            if (isConnectCommand && IsConnectionRecentlyConnected(name))
            {
                results.Add($"{name}: already connected; skipped duplicate connect");
                continue;
            }

            if (isConnectCommand &&
                _lastPropConnectRequestUtc.TryGetValue(name, out var lastConnectRequestUtc) &&
                DateTimeOffset.UtcNow - lastConnectRequestUtc < TimeSpan.FromSeconds(20))
            {
                results.Add($"{name}: connect already requested; waiting for NinjaTrader status");
                continue;
            }

            var payload = JsonSerializer.SerializeToElement(new { connectionName = name });
            var res = await bridge.SendAsync(new IpcRequest { Command = command, Payload = payload });
            var msg = res == null
                ? "No response."
                : res.Ok
                    ? string.IsNullOrWhiteSpace(res.Message) ? "OK" : res.Message
                    : string.IsNullOrWhiteSpace(res.Message) ? "Failed." : res.Message;
            if (isConnectCommand && res?.Ok == true)
                _lastPropConnectRequestUtc[name] = DateTimeOffset.UtcNow;
            results.Add($"{name}: {msg}");
        }

        var resultText = $"{label}: {string.Join(" | ", results)}";
        PingResult.Text = resultText;
        StatusText.Text = resultText;
    }

    private static bool IsConnectionRecentlyConnected(string connectionName)
    {
        if (string.IsNullOrWhiteSpace(connectionName))
            return false;

        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "NinjaTrader 8");
        var logDirs = new[]
        {
            Path.Combine(root, "log"),
            Path.Combine(root, "trace")
        };

        var latestStatus = "";
        var latestStatusTime = DateTimeOffset.MinValue;
        foreach (var file in logDirs
                     .Where(Directory.Exists)
                     .SelectMany(dir => new DirectoryInfo(dir).EnumerateFiles("*.txt"))
                     .Where(f => f.Length is > 0 and < 50_000_000)
                     .OrderByDescending(f => f.LastWriteTimeUtc)
                     .Take(8))
        {
            try
            {
                foreach (var line in ReadRecentLogLines(file.FullName, 800))
                {
                    if (TryReadConnectionStatus(line, connectionName, out var status) &&
                        TryReadNinjaTraderLogTime(line, out var statusTime) &&
                        statusTime > latestStatusTime)
                    {
                        latestStatus = status;
                        latestStatusTime = statusTime;
                    }
                }
            }
            catch
            {
                // NinjaTrader can roll logs while the manager is reading them.
            }
        }

        return latestStatus.Equals("Connected", StringComparison.OrdinalIgnoreCase)
               || latestStatus.Equals("Connecting", StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> ReadRecentLogLines(string path, int maxLines)
    {
        var tail = new Queue<string>(Math.Max(maxLines, 1));
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var reader = new StreamReader(stream);

        while (reader.ReadLine() is { } line)
        {
            tail.Enqueue(line);
            while (tail.Count > maxLines)
                tail.Dequeue();
        }

        return tail;
    }

    private static bool TryReadConnectionStatus(string line, string connectionName, out string status)
    {
        status = "";
        if (string.IsNullOrWhiteSpace(line) || string.IsNullOrWhiteSpace(connectionName))
            return false;

        var escaped = Regex.Escape(connectionName.Trim());
        var primary = Regex.Match(line,
            $@"\|{escaped}:\s*Primary connection=(?<status>Connected|Connecting|Disconnected|Disconnecting|Connection lost)",
            RegexOptions.IgnoreCase);
        if (primary.Success)
        {
            status = primary.Groups["status"].Value;
            return true;
        }

        var trace = Regex.Match(line,
            $@"\({escaped}\)\s+Cbi\.Connection\.ConnectionStatusCallback:\s+status=(?<status>Connected|Connecting|Disconnected|Disconnecting)",
            RegexOptions.IgnoreCase);
        if (trace.Success)
        {
            status = trace.Groups["status"].Value;
            return true;
        }

        return false;
    }

    private static bool TryReadNinjaTraderLogTime(string line, out DateTimeOffset timestamp)
    {
        timestamp = DateTimeOffset.MinValue;
        if (line.Length < 23)
            return false;

        var raw = line[..23];
        if (!DateTime.TryParseExact(raw, "yyyy-MM-dd HH:mm:ss:fff", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal, out var localTime))
            return false;

        timestamp = new DateTimeOffset(localTime);
        return true;
    }

    private async Task SendSimpleIpcCommandAsync(string command, string label)
    {
        var bridge = _sp.GetRequiredService<INinjaTraderBridge>();
        var res = await bridge.SendAsync(new IpcRequest { Command = command });
        var msg = res == null
            ? "No response."
            : res.Ok
                ? string.IsNullOrWhiteSpace(res.Message) ? "OK" : res.Message
                : string.IsNullOrWhiteSpace(res.Message) ? "Failed." : res.Message;

        var resultText = $"{label}: {msg}";
        PingResult.Text = resultText;
        StatusText.Text = resultText;
    }

    private static List<string> SplitConnectionNames(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return new List<string>();

        return raw.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string CleanAccountName(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "" : value.Trim();

    private static string NormalizeAccountKey(string? value) =>
        CleanAccountName(value).ToUpperInvariant();

    private void SelectExistingConnections()
    {
        AvailablePropConnectionsList.SelectedItems.Clear();
        var selected = SplitConnectionNames(PropConnectionNameBox.Text);
        if (selected.Count == 0)
            selected = SplitConnectionNames(_config.PropConnectionName);

        foreach (var connection in _availablePropConnections)
        {
            if (selected.Contains(connection, StringComparer.OrdinalIgnoreCase))
                AvailablePropConnectionsList.SelectedItems.Add(connection);
        }
    }

    private static List<string> ReadStringArrayPayload(IpcResponse? response, string propertyName)
    {
        if (response?.Ok != true || response.Payload is not { } payload)
            return new List<string>();

        if (!payload.TryGetProperty(propertyName, out var array) || array.ValueKind != JsonValueKind.Array)
            return new List<string>();

        return array.EnumerateArray()
            .Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async void AccountList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AccountList.SelectedItem is not TradingAccountEntity acct)
        {
            PerfGrid.ItemsSource = null;
            AccountAlgoGrid.ItemsSource = null;
            AccountPnlSummaryText.Text = "Select an account to view PnL.";
            AccountAlgoSummaryText.Text = "Attached algos will show below.";
            return;
        }

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var rows = await db.PerformanceDaily.AsNoTracking()
            .Where(p => p.AccountId == acct.Id)
            .OrderByDescending(p => p.DateEastern)
            .Take(90)
            .ToListAsync();
        PerfGrid.ItemsSource = rows;

        var stackRows = await db.StackStrategies.AsNoTracking()
            .Where(s => s.AccountId == acct.Id)
            .OrderBy(s => s.SortOrder)
            .ToListAsync();
        AccountAlgoGrid.ItemsSource = stackRows;

        var totalPnl = rows.Sum(r => r.Pnl);
        var totalTrades = rows.Sum(r => r.TradeCount);
        var latest = rows.OrderByDescending(r => r.DateEastern).FirstOrDefault();
        var latestText = latest is null
            ? "Latest: no PnL imported"
            : $"Latest: {latest.DateEastern:yyyy-MM-dd} {latest.Pnl:C} / {latest.TradeCount} trade(s)";
        AccountPnlSummaryText.Text =
            $"{acct.DisplayName} | 90-day PnL: {totalPnl:C} | Trades: {totalTrades} | {latestText}";
        var checkedRows = stackRows.Count(s => s.IncludeInApply);
        AccountAlgoSummaryText.Text =
            $"{stackRows.Count} saved algo row(s), {checkedRows} checked for apply.";
    }

    private async void StackAccountCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loadingStackAccount)
            return;

        if (e.RemovedItems.Count > 0 && e.RemovedItems[0] is TradingAccountEntity previous && _stackRows.Count > 0)
        {
            await SaveVisibleStackAsync(previous);
            StatusText.Text = $"Saved {previous.DisplayName}; loaded selected account.";
        }

        await LoadStackForSelectedAccountAsync();
    }

    private async Task LoadStackForSelectedAccountAsync()
    {
        _loadingStackAccount = true;
        _stackRows.Clear();
        try
        {
            if (StackAccountCombo.SelectedItem is not TradingAccountEntity acct)
                return;

            var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
            await using var db = await dbf.CreateDbContextAsync();
            var rows = await db.StackStrategies.AsNoTracking()
                .Where(s => s.AccountId == acct.Id)
                .OrderBy(s => s.SortOrder)
                .ToListAsync();

            foreach (var r in rows)
            {
                _stackRows.Add(new StackRowVm
                {
                    Id = r.Id,
                    AccountId = r.AccountId,
                    IncludeInApply = r.IncludeInApply,
                    TradingPeriod = string.IsNullOrEmpty(r.TradingPeriod) ? "" : r.TradingPeriod,
                    StrategyTypeName = r.StrategyTypeName,
                    Instrument = r.Instrument,
                    TemplateName = r.TemplateName,
                    InstanceLabel = r.InstanceLabel,
                    AccountAttachment = r.AccountAttachment ?? ""
                });
            }
        }
        finally
        {
            _loadingStackAccount = false;
        }
    }

    private async void PreviousStackAccount_Click(object sender, RoutedEventArgs e)
    {
        await MoveStackAccountAsync(-1);
    }

    private async void NextStackAccount_Click(object sender, RoutedEventArgs e)
    {
        await MoveStackAccountAsync(1);
    }

    private async Task MoveStackAccountAsync(int direction)
    {
        if (_accounts.Count == 0)
            return;

        var currentIndex = StackAccountCombo.SelectedIndex;
        if (currentIndex < 0)
            currentIndex = 0;

        if (StackAccountCombo.SelectedItem is TradingAccountEntity current)
            await SaveVisibleStackAsync(current);

        var nextIndex = Math.Clamp(currentIndex + direction, 0, _accounts.Count - 1);
        if (nextIndex == currentIndex)
        {
            StatusText.Text = direction < 0 ? "Already on the first account." : "Already on the last account.";
            return;
        }

        _loadingStackAccount = true;
        try
        {
            StackAccountCombo.SelectedIndex = nextIndex;
        }
        finally
        {
            _loadingStackAccount = false;
        }

        await LoadStackForSelectedAccountAsync();
        StatusText.Text = $"Saved account edits; loaded {_accounts[nextIndex].DisplayName}.";
    }

    private void StackGrid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e)
    {
        // deferred save until Save stack
    }

    private void AddStackRow_Click(object sender, RoutedEventArgs e)
    {
        if (StackAccountCombo.SelectedItem is not TradingAccountEntity acct)
        {
            MessageBox.Show("Select an account first.");
            return;
        }

        _stackRows.Add(new StackRowVm
        {
            Id = Guid.NewGuid(),
            AccountId = acct.Id,
            IncludeInApply = true,
            TradingPeriod = "",
            StrategyTypeName = "",
            Instrument = "",
            TemplateName = "",
            InstanceLabel = "",
            AccountAttachment = acct.RawAccountNumber
        });
    }

    private void DeleteStackRow_Click(object sender, RoutedEventArgs e)
    {
        if (StackGrid.SelectedItem is StackRowVm v)
            _stackRows.Remove(v);
    }

    private async void SaveStack_Click(object sender, RoutedEventArgs e)
    {
        if (StackAccountCombo.SelectedItem is not TradingAccountEntity acct)
            return;

        await SaveVisibleStackAsync(acct);
        StatusText.Text = "Stack saved locally.";
        await RefreshNtTemplateChoicesAsync();
    }

    private async Task SaveVisibleStackAsync(TradingAccountEntity acct)
    {
        StackGrid.CommitEdit(DataGridEditingUnit.Cell, true);
        StackGrid.CommitEdit(DataGridEditingUnit.Row, true);

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();

        var old = db.StackStrategies.Where(s => s.AccountId == acct.Id);
        db.StackStrategies.RemoveRange(old);

        var n = 0;
        foreach (var row in _stackRows)
        {
            var instrument = ExcelImportService.ResolveInstrumentForStrategy(row.StrategyTypeName, row.Instrument);
            row.Instrument = instrument;
            db.StackStrategies.Add(new StackStrategyRowEntity
            {
                Id = row.Id,
                AccountId = acct.Id,
                IncludeInApply = row.IncludeInApply,
                TradingPeriod = row.TradingPeriod ?? "",
                StrategyTypeName = row.StrategyTypeName,
                Instrument = instrument,
                TemplateName = row.TemplateName,
                InstanceLabel = row.InstanceLabel,
                AccountAttachment = string.IsNullOrWhiteSpace(row.AccountAttachment) ? null : row.AccountAttachment,
                SortOrder = n++
            });
        }

        await db.SaveChangesAsync();
    }

    private async void ApplyStack_Click(object sender, RoutedEventArgs e)
    {
        if (StackAccountCombo.SelectedItem is not TradingAccountEntity acct)
            return;

        StackGrid.CommitEdit(DataGridEditingUnit.Cell, true);
        StackGrid.CommitEdit(DataGridEditingUnit.Row, true);

        var filter = SelectedApplyPeriodFilter;
        var rowsToApply = _stackRows
            .Where(r => r.IncludeInApply)
            .Where(r => filter switch
            {
                StackApplyPeriodFilter.Period1Only => r.TradingPeriod == "Period1",
                StackApplyPeriodFilter.Period2Only => r.TradingPeriod == "Period2",
                _ => true
            })
            .ToList();
        if (rowsToApply.Count == 0)
        {
            MessageBox.Show("No rows are checked for the selected Apply to NT filter.", "Apply",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var rowPreview = string.Join(Environment.NewLine,
            rowsToApply.Take(8).Select(r => $"- {r.StrategyTypeName} {r.Instrument} ({r.TradingPeriod})"));
        if (rowsToApply.Count > 8)
            rowPreview += $"{Environment.NewLine}- ... {rowsToApply.Count - 8} more";

        var preview = MessageBox.Show(
            $"Apply these checked rows to NinjaTrader?{Environment.NewLine}{Environment.NewLine}{rowPreview}",
            "Confirm",
            MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (preview != MessageBoxResult.Yes)
            return;

        await SaveVisibleStackAsync(acct);
        StatusText.Text = "Stack saved; applying to NinjaTrader.";
        var (ok, msg) = await _stackApply.ExecuteAsync(acct.Id, _config.DryRun, filter, default);
        MessageBox.Show(ok ? msg : msg, ok ? "Apply" : "Error", MessageBoxButton.OK,
            ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }

    private async void ApplyAllStacks_Click(object sender, RoutedEventArgs e)
    {
        if (StackAccountCombo.SelectedItem is TradingAccountEntity acct)
            await SaveVisibleStackAsync(acct);

        var targets = await GetStackAttachTargetsAsync(latestBlueprintOnly: false);
        if (targets.Count == 0)
        {
            MessageBox.Show("No checked stack rows are ready to add. Review Edit Stack and check the rows to add.",
                "Add All to NinjaTrader", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        await ApplyAttachTargetsAsync(targets, "Add All to NinjaTrader");
    }

    private async void PickExcel_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFileDialog { Filter = "Excel|*.xlsx;*.xls" };
        if (dlg.ShowDialog() != true)
            return;

        await using var fs = File.OpenRead(dlg.FileName);
        var (rows, _) = await _excel.ParseAsync(fs, default);
        await RefreshNtTemplateChoicesAsync();
        _lastExcelRows = rows.Select(PrepareBlueprintRow).ToList();
        _excelMap.Clear();

        BlueprintImportStatusText.Text = "Refreshing current NinjaTrader accounts from the Control Center UI...";
        var accs = await RefreshAccountsFromNinjaTraderUiAsync(timeout: TimeSpan.FromSeconds(12));
        if (accs.Count == 0)
        {
            StatusText.Text = "Blueprint parsed, but NinjaTrader UI did not expose any current accounts.";
            BlueprintImportStatusText.Text =
                "No current NinjaTrader accounts were found from the Control Center UI. Open NinjaTrader, show the Control Center Accounts tab, then choose the blueprint again.";
            MessageBox.Show(
                "No current NinjaTrader accounts were found from the Control Center UI. The manager will not use saved or log-derived accounts for blueprint setup.",
                "Blueprint Import",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            return;
        }

        await ReloadAccountsAsync();

        foreach (var raw in rows.Select(r => r.RawAccountHint).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var row = new ExcelMapRow();
            row.Raw = raw;
            foreach (var a in accs)
                row.AccountChoices.Add(a);

            var rawKey = NormalizeAccountKey(raw);
            var match = accs.FirstOrDefault(a =>
                string.Equals(NormalizeAccountKey(a.RawAccountNumber), rawKey, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(NormalizeAccountKey(a.DisplayName), rawKey, StringComparison.OrdinalIgnoreCase));
            row.SelectedAccountId = match?.Id;

            _excelMap.Add(row);
        }

        StatusText.Text =
            $"Parsed {_lastExcelRows.Count} row(s) from spreadsheet; account choices refreshed from NinjaTrader UI.";
        BlueprintImportStatusText.Text =
            $"Parsed {_lastExcelRows.Count} algo row(s). Map each blueprint account to one of the {accs.Count} current NinjaTrader UI account(s), then save setup.";
    }

    private async void ImportExcel_Click(object sender, RoutedEventArgs e)
    {
        if (_lastExcelRows.Count == 0)
        {
            MessageBox.Show("Choose a spreadsheet first.");
            return;
        }

        var map = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (ExcelMapRow m in _excelMap)
        {
            if (m.SelectedAccountId is { } id)
                map[m.Raw] = id;
        }

        if (map.Count == 0)
        {
            MessageBox.Show("Map at least one raw account.");
            return;
        }

        var preparedRows = _lastExcelRows.Select(PrepareBlueprintRow).ToList();
        await _excel.UpsertStacksFromImportAsync(map, preparedRows, ReplaceStacks.IsChecked == true, default);
        _lastBlueprintAccountIds.Clear();
        foreach (var id in map.Values.Distinct())
            _lastBlueprintAccountIds.Add(id);
        await ReloadAccountsAsync();
        await RefreshNtTemplateChoicesAsync();
        var firstMapped = _accounts.FirstOrDefault(a => _lastBlueprintAccountIds.Contains(a.Id));
        if (firstMapped is not null)
        {
            _loadingStackAccount = true;
            try
            {
                StackAccountCombo.SelectedItem = firstMapped;
            }
            finally
            {
                _loadingStackAccount = false;
            }
        }
        await LoadStackForSelectedAccountAsync();
        var accountCount = _lastBlueprintAccountIds.Count;
        BlueprintImportStatusText.Text =
            $"Saved setup for {accountCount} NinjaTrader account(s). Review each account in Edit Stack, then click Add All to NinjaTrader.";
        MainTabs.SelectedItem = EditStackTab;
        MessageBox.Show("Setup saved. Review each account in Edit Stack, then click Add All to NinjaTrader.");
    }

    private async void AttachSavedSetupToNinjaTrader_Click(object sender, RoutedEventArgs e)
    {
        var targets = await GetStackAttachTargetsAsync(latestBlueprintOnly: true);
        if (targets.Count == 0)
        {
            MessageBox.Show("No saved setup rows are ready to attach. Import the blueprint and save setup first.",
                "Attach to NinjaTrader", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        await ApplyAttachTargetsAsync(targets, "Attach to NinjaTrader");
    }

    private async Task<List<AttachTarget>> GetStackAttachTargetsAsync(bool latestBlueprintOnly)
    {
        if (latestBlueprintOnly && _lastBlueprintAccountIds.Count == 0)
            return new List<AttachTarget>();

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var filter = SelectedApplyPeriodFilter;
        var query = db.StackStrategies.AsNoTracking()
            .Where(s => s.IncludeInApply);

        if (filter == StackApplyPeriodFilter.Period1Only)
            query = query.Where(s => s.TradingPeriod == "Period1");
        else if (filter == StackApplyPeriodFilter.Period2Only)
            query = query.Where(s => s.TradingPeriod == "Period2");

        if (latestBlueprintOnly)
            query = query.Where(s => _lastBlueprintAccountIds.Contains(s.AccountId));

        var rows = await query
            .GroupBy(s => s.AccountId)
            .Select(g => new { AccountId = g.Key, RowCount = g.Count() })
            .ToListAsync();

        var accounts = await db.Accounts.AsNoTracking().ToListAsync();
        return rows
            .Join(accounts,
                r => r.AccountId,
                a => a.Id,
                (r, a) => new AttachTarget(a.Id, a.DisplayName, r.RowCount))
            .OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async Task ApplyAttachTargetsAsync(List<AttachTarget> targets, string title)
    {
        var filter = SelectedApplyPeriodFilter;
        var batchId = DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
        var preview = string.Join(Environment.NewLine,
            targets.Take(12).Select(t => $"- {t.DisplayName} ({t.RowCount} checked row(s))"));
        if (targets.Count > 12)
            preview += $"{Environment.NewLine}- ... {targets.Count - 12} more";

        var confirm = MessageBox.Show(
            $"Add checked stack rows to NinjaTrader for these account(s)?{Environment.NewLine}{Environment.NewLine}{preview}{Environment.NewLine}{Environment.NewLine}If an account fails, the batch stops immediately and writes an audit file.",
            title,
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);
        if (confirm != MessageBoxResult.Yes)
            return;

        StatusText.Text = $"Adding setup to NinjaTrader for {targets.Count} account(s)...";
        BlueprintImportStatusText.Text = StatusText.Text;

        var results = new List<string>();
        var auditRows = new List<object>();
        foreach (var target in targets)
        {
            var (ok, msg) = await _stackApply.ExecuteAsync(target.Id, _config.DryRun, filter, default);
            var oneLine = TrimOneLine(msg, 280);
            results.Add($"{target.DisplayName}: {(ok ? "OK" : "FAIL")} {TrimOneLine(msg, 140)}");
            auditRows.Add(new
            {
                target.Id,
                target.DisplayName,
                target.RowCount,
                ok,
                message = oneLine,
                completedAt = DateTimeOffset.Now
            });
            if (!ok)
                break;
        }

        var resultText = string.Join(Environment.NewLine, results);
        var failed = results.Any(r => r.Contains(": FAIL", StringComparison.OrdinalIgnoreCase));
        var auditPath = await WriteAttachBatchAuditAsync(batchId, title, filter, targets, auditRows, failed);
        var suffix = string.IsNullOrWhiteSpace(auditPath)
            ? ""
            : $"{Environment.NewLine}{Environment.NewLine}Audit: {auditPath}";
        BlueprintImportStatusText.Text = resultText + suffix;
        StatusText.Text = failed
            ? $"Add stopped after failure ({results.Count}/{targets.Count} account(s) attempted)."
            : $"Add complete for {targets.Count} account(s).";
        MessageBox.Show(resultText + suffix, title, MessageBoxButton.OK,
            failed
                ? MessageBoxImage.Warning
                : MessageBoxImage.Information);
    }

    private async Task<string> WriteAttachBatchAuditAsync(
        string batchId,
        string title,
        StackApplyPeriodFilter filter,
        IReadOnlyList<AttachTarget> targets,
        IReadOnlyList<object> results,
        bool failed)
    {
        try
        {
            var dir = Path.Combine(_config.DataDirectory, "logs", "stack-apply-batches");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, $"stack-apply-batch-{batchId}.json");
            var payload = new
            {
                batchId,
                title,
                dryRun = _config.DryRun,
                periodFilter = filter.ToString(),
                startedAccountCount = targets.Count,
                attemptedAccountCount = results.Count,
                stoppedOnFailure = failed,
                targets = targets.Select(t => new { t.Id, t.DisplayName, t.RowCount }),
                results
            };
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                WriteIndented = true
            }));
            return path;
        }
        catch (Exception ex)
        {
            StatusText.Text = "Add completed, but the batch audit could not be written: " + ex.Message;
            return "";
        }
    }

    private static string TrimOneLine(string? value, int maxLength)
    {
        var text = string.IsNullOrWhiteSpace(value)
            ? ""
            : value.Replace("\r", " ", StringComparison.Ordinal)
                .Replace("\n", " ", StringComparison.Ordinal)
                .Trim();
        return text.Length <= maxLength ? text : text[..maxLength] + "...";
    }

    private sealed record AttachTarget(Guid Id, string DisplayName, int RowCount);

    private sealed record NinjaTraderUiScanResult(List<string> Connections, List<string> Accounts, string Detail);

    public sealed class StackRowVm : INotifyPropertyChanged
    {
        public Guid Id { get; set; }
        public Guid AccountId { get; set; }

        private bool _includeInApply = true;
        private string _tradingPeriod = "";
        private string _strategyTypeName = "";
        private string _instrument = "";
        private string _templateName = "";
        private string _instanceLabel = "";
        private string _accountAttachment = "";

        public bool IncludeInApply
        {
            get => _includeInApply;
            set { _includeInApply = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IncludeInApply))); }
        }

        /// <summary>Empty, Period1, or Period2.</summary>
        public string TradingPeriod
        {
            get => _tradingPeriod;
            set { _tradingPeriod = value ?? ""; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(TradingPeriod))); }
        }

        public string StrategyTypeName
        {
            get => _strategyTypeName;
            set { _strategyTypeName = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StrategyTypeName))); }
        }

        public string Instrument
        {
            get => _instrument;
            set { _instrument = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Instrument))); }
        }

        public string TemplateName
        {
            get => _templateName;
            set { _templateName = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(TemplateName))); }
        }

        public string InstanceLabel
        {
            get => _instanceLabel;
            set { _instanceLabel = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(InstanceLabel))); }
        }

        public string AccountAttachment
        {
            get => _accountAttachment;
            set { _accountAttachment = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(AccountAttachment))); }
        }

        public event PropertyChangedEventHandler? PropertyChanged;
    }

    public sealed class ExcelMapRow : INotifyPropertyChanged
    {
        private string _raw = "";
        private Guid? _selectedAccountId;

        public string Raw
        {
            get => _raw;
            set { _raw = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Raw))); }
        }

        public ObservableCollection<TradingAccountEntity> AccountChoices { get; } = new();

        public Guid? SelectedAccountId
        {
            get => _selectedAccountId;
            set { _selectedAccountId = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SelectedAccountId))); }
        }

        public event PropertyChangedEventHandler? PropertyChanged;
    }
}
