using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
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
    private readonly DeveloperAccessGate _devGate;

    private readonly ObservableCollection<TradingAccountEntity> _accounts = new();
    private readonly ObservableCollection<StackRowVm> _stackRows = new();
    private readonly ObservableCollection<ExcelMapRow> _excelMap = new();

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
        _devGate = sp.GetRequiredService<DeveloperAccessGate>();

        AccountList.ItemsSource = _accounts;
        StackGrid.ItemsSource = _stackRows;
        ExcelMappingItems.ItemsSource = _excelMap;

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
            ? "DRY_RUN is enabled — NinjaTrader IPC calls return simulated success."
            : "";
        IpcHintText.Text =
            $"Pipe name: {_config.IpcPipeName}  |  {_config.IpcRetryAttempts} attempts × {_config.IpcConnectTimeoutMs} ms + {_config.IpcRetryDelayMs} ms pause\n" +
            $"DRY_RUN: {_config.DryRun} (set false in .env for real named-pipe IPC)\n" +
            $"PROP_CONNECTION_NAME: {(_config.PropConnectionName ?? "(unset)")}\n" +
            "IPC requires NinjaTrader with the Add-On compiled (NT Output: pipe server starting…). Pull latest nt8-addon — older builds leaked pipe handles.";

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
        BotStateText.Text = "Stopped";
    }

    private StackApplyPeriodFilter SelectedApplyPeriodFilter =>
        ApplyFilterCombo.SelectedItem is ComboBoxItem i && i.Tag is StackApplyPeriodFilter f
            ? f
            : StackApplyPeriodFilter.AllEnabled;

    private async Task RefreshNtTemplateChoicesAsync()
    {
        var merged = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in _config.NtTemplateChoiceList)
            merged.Add(x);

        try
        {
            var disco = _sp.GetRequiredService<NinjaTraderTemplateDiscoveryService>();
            foreach (var x in disco.DiscoverXmlTemplateNames(_config))
                merged.Add(x);
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
                .Select(s => s.TemplateName)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Distinct()
                .ToListAsync();
            foreach (var t in tpls)
                merged.Add(t);
        }
        catch
        {
            /* ignore template refresh if DB busy */
        }

        NtTemplateChoices.Clear();
        foreach (var x in merged.OrderBy(s => s))
            NtTemplateChoices.Add(x);
    }

    private async void RefreshNtTemplates_Click(object sender, RoutedEventArgs e)
    {
        await RefreshNtTemplateChoicesAsync();
        StatusText.Text =
            "Template list refreshed (.env + *.xml under NinjaTrader 8\\templates + saved stacks).";
    }

    private async Task ReloadAccountsAsync()
    {
        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();
        var list = await db.Accounts.AsNoTracking().OrderBy(a => a.DisplayName).ToListAsync();
        _accounts.Clear();
        foreach (var a in list)
            _accounts.Add(a);
    }

    private void StartBot_Click(object sender, RoutedEventArgs e)
    {
        _orchestrator.Start();
        _logWatcher.Alert -= OnLogAlert;
        _logWatcher.Alert += OnLogAlert;
        _logWatcher.Start();
        StartBotBtn.IsEnabled = false;
        StopBotBtn.IsEnabled = true;
        BotStateText.Text = "Running";
        StatusText.Text = "Bot armed (Mon–Fri Eastern schedule)";
        _ = _telegram.SendAsync("Vincere Ops: bot started.");
    }

    private void StopBot_Click(object sender, RoutedEventArgs e)
    {
        _orchestrator.Stop();
        _logWatcher.Alert -= OnLogAlert;
        StartBotBtn.IsEnabled = true;
        StopBotBtn.IsEnabled = false;
        BotStateText.Text = "Stopped";
        StatusText.Text = "Stopped";
        _ = _telegram.SendAsync("Vincere Ops: bot stopped.");
    }

    private void OnLogAlert(object? sender, string msg)
    {
        Dispatcher.Invoke(() => StatusText.Text = msg);
        _ = _telegram.SendAsync("Vincere Ops alert: " + msg);
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
                : detail;
    }

    private async void AccountList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AccountList.SelectedItem is not TradingAccountEntity acct)
        {
            PerfGrid.ItemsSource = null;
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
    }

    private async void StackAccountCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        await LoadStackForSelectedAccountAsync();
    }

    private async Task LoadStackForSelectedAccountAsync()
    {
        _stackRows.Clear();
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
                TemplateName = r.TemplateName,
                InstanceLabel = r.InstanceLabel,
                AccountAttachment = r.AccountAttachment ?? ""
            });
        }
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

        var dbf = _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>();
        await using var db = await dbf.CreateDbContextAsync();

        var old = db.StackStrategies.Where(s => s.AccountId == acct.Id);
        db.StackStrategies.RemoveRange(old);

        var n = 0;
        foreach (var row in _stackRows)
        {
            db.StackStrategies.Add(new StackStrategyRowEntity
            {
                Id = row.Id,
                AccountId = acct.Id,
                IncludeInApply = row.IncludeInApply,
                TradingPeriod = row.TradingPeriod ?? "",
                StrategyTypeName = row.StrategyTypeName,
                TemplateName = row.TemplateName,
                InstanceLabel = row.InstanceLabel,
                AccountAttachment = string.IsNullOrWhiteSpace(row.AccountAttachment) ? null : row.AccountAttachment,
                SortOrder = n++
            });
        }

        await db.SaveChangesAsync();
        StatusText.Text = "Stack saved locally.";
        await RefreshNtTemplateChoicesAsync();
    }

    private async void ApplyStack_Click(object sender, RoutedEventArgs e)
    {
        if (StackAccountCombo.SelectedItem is not TradingAccountEntity acct)
            return;

        var preview = MessageBox.Show(
            "Apply current stack (respecting Apply checkboxes and Period filter above) to NinjaTrader via IPC?",
            "Confirm",
            MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (preview != MessageBoxResult.Yes)
            return;

        var filter = SelectedApplyPeriodFilter;
        var (ok, msg) = await _stackApply.ExecuteAsync(acct.Id, _config.DryRun, filter, default);
        MessageBox.Show(ok ? msg : msg, ok ? "Apply" : "Error", MessageBoxButton.OK,
            ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }

    private async void PickExcel_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFileDialog { Filter = "Excel|*.xlsx;*.xls" };
        if (dlg.ShowDialog() != true)
            return;

        await using var fs = File.OpenRead(dlg.FileName);
        var (rows, _) = await _excel.ParseAsync(fs, default);
        _lastExcelRows = rows.ToList();
        _excelMap.Clear();

        await using var db = await _sp.GetRequiredService<IDbContextFactory<VincereDbContext>>().CreateDbContextAsync();
        var accs = await db.Accounts.AsNoTracking().ToListAsync();

        foreach (var raw in rows.Select(r => r.RawAccountHint).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var row = new ExcelMapRow();
            row.Raw = raw;
            foreach (var a in accs)
                row.AccountChoices.Add(a);

            var match = accs.FirstOrDefault(a =>
                string.Equals(a.RawAccountNumber, raw, StringComparison.OrdinalIgnoreCase));
            row.SelectedAccountId = match?.Id;

            _excelMap.Add(row);
        }

        StatusText.Text = $"Parsed {rows.Count} row(s) from spreadsheet.";
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

        await _excel.UpsertStacksFromImportAsync(map, _lastExcelRows, ReplaceStacks.IsChecked == true, default);
        await ReloadAccountsAsync();
        await RefreshNtTemplateChoicesAsync();
        await LoadStackForSelectedAccountAsync();
        MessageBox.Show("Import complete.");
    }

    private void DevOpen_Click(object sender, RoutedEventArgs e)
    {
        var pc = new PasscodeWindow { Owner = this };
        if (pc.ShowDialog() != true || string.IsNullOrEmpty(pc.Passcode))
            return;

        if (!_devGate.TryEnter(pc.Passcode, _config.EffectiveDeveloperPasscode))
        {
            MessageBox.Show("Invalid passcode or locked out.");
            return;
        }

        new DeveloperEnvWindow(_sp) { Owner = this }.ShowDialog();
    }

    public sealed class StackRowVm : INotifyPropertyChanged
    {
        public Guid Id { get; set; }
        public Guid AccountId { get; set; }

        private bool _includeInApply = true;
        private string _tradingPeriod = "";
        private string _strategyTypeName = "";
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
