using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using System.Xml.Linq;

namespace Vincere.Operator;

public sealed record NinjaTraderUiScanResult(List<string> Connections, List<string> Accounts, string Detail);
public sealed record NinjaTraderStrategyToggleResult(bool Ok, int VisibleCheckboxes, int Changed, string Message);
public sealed record NinjaTraderGridSafetySnapshot(
    int OrdersGridCount,
    int PositionsGridCount,
    int StrategiesGridCount,
    int VisibleStrategyEnabledCount,
    int VisibleStrategyDisabledCount,
    bool EnabledStateUncertain,
    bool GridCountUncertain,
    string ReadError)
{
    public bool BlocksAddAll =>
        GridCountUncertain ||
        EnabledStateUncertain ||
        OrdersGridCount != 0 ||
        PositionsGridCount != 0 ||
        VisibleStrategyEnabledCount != 0;
}

public static class NinjaTraderUiDiscovery
{
    private static readonly Regex AccountPattern = new(
        @"\b(?:[A-Z]{2,5}\d{6,}|Sim\d{2,4}|Playback\d{2,4}|Backtest)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ConnectionPattern = new(
        @"^(Apex|Lucid|Topstep|Take Profit|MyFundedFutures|Tradeify|Earn2Trade|BluSky|TickTickTrader|NinjaTrader)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool IsNinjaTraderRunning()
    {
        return Process.GetProcessesByName("NinjaTrader").Length > 0;
    }

    public static bool EnsureNinjaTraderStarted()
    {
        if (IsNinjaTraderRunning())
            return false;

        var exe = @"C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe";
        if (!File.Exists(exe))
            throw new FileNotFoundException("NinjaTrader executable was not found.", exe);

        Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = true
        });
        return true;
    }

    public static async Task<NinjaTraderUiScanResult> ScanAsync(TimeSpan? timeout = null)
    {
        var tcs = new TaskCompletionSource<NinjaTraderUiScanResult>();
        var thread = new Thread(() =>
        {
            try
            {
                tcs.SetResult(Scan());
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
            return await tcs.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(8));
        }
        catch (TimeoutException)
        {
            return new NinjaTraderUiScanResult(new List<string>(), new List<string>(),
                "NinjaTrader UI scan timed out. Make sure the Control Center is open and visible.");
        }
    }

    public static async Task<NinjaTraderStrategyToggleResult> SetAllStrategiesEnabledAsync(
        bool enabled,
        TimeSpan? timeout = null)
    {
        var tcs = new TaskCompletionSource<NinjaTraderStrategyToggleResult>();
        var thread = new Thread(() =>
        {
            try
            {
                tcs.SetResult(SetAllStrategiesEnabled(enabled));
            }
            catch (Exception ex)
            {
                tcs.SetResult(new NinjaTraderStrategyToggleResult(false, 0, 0,
                    $"NinjaTrader strategy toggle failed: {ex.Message}"));
            }
        })
        {
            IsBackground = true,
            Name = enabled ? "NinjaTrader enable strategies" : "NinjaTrader disable strategies"
        };

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        try
        {
            return await tcs.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(15));
        }
        catch (TimeoutException)
        {
            return new NinjaTraderStrategyToggleResult(false, 0, 0,
                "NinjaTrader strategy toggle timed out. Make sure the Control Center Strategies tab is visible.");
        }
    }

    public static async Task<NinjaTraderGridSafetySnapshot> GetGridSafetySnapshotAsync(TimeSpan? timeout = null)
    {
        var tcs = new TaskCompletionSource<NinjaTraderGridSafetySnapshot>();
        var thread = new Thread(() =>
        {
            try
            {
                tcs.SetResult(GetGridSafetySnapshot());
            }
            catch (Exception ex)
            {
                tcs.SetResult(new NinjaTraderGridSafetySnapshot(
                    -1, -1, -1, 0, 0, true, true,
                    $"NinjaTrader grid safety snapshot failed: {ex.Message}"));
            }
        })
        {
            IsBackground = true,
            Name = "NinjaTrader grid safety snapshot"
        };

        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        try
        {
            return await tcs.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(12));
        }
        catch (TimeoutException)
        {
            return new NinjaTraderGridSafetySnapshot(
                -1, -1, -1, 0, 0, true, true,
                "NinjaTrader grid safety snapshot timed out. Make sure the Control Center is open and visible.");
        }
    }

    private static NinjaTraderStrategyToggleResult SetAllStrategiesEnabled(bool enabled)
    {
        if (!IsNinjaTraderRunning())
            return new NinjaTraderStrategyToggleResult(false, 0, 0, "NinjaTrader is not running.");

        var desktop = AutomationElement.RootElement;
        AutomationElement? controlCenter = null;
        foreach (var process in Process.GetProcessesByName("NinjaTrader"))
        {
            var processCondition = new PropertyCondition(AutomationElement.ProcessIdProperty, process.Id);
            controlCenter = FindControlCenter(desktop, processCondition);
            if (controlCenter is not null)
                break;
        }

        if (controlCenter is null)
            return new NinjaTraderStrategyToggleResult(false, 0, 0,
                "NinjaTrader Control Center was not found.");

        TryBringWindowToFront(controlCenter);
        if (!TrySelectTab(controlCenter, "StrategiesGridTabItem"))
            return new NinjaTraderStrategyToggleResult(false, 0, 0,
                "NinjaTrader Strategies tab was not found.");

        Thread.Sleep(300);
        var grid = controlCenter.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, "StrategiesGrid"));
        if (grid is null)
            return new NinjaTraderStrategyToggleResult(false, 0, 0,
                "NinjaTrader Strategies grid was not found.");

        var checkboxes = grid.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox));
        var visible = 0;
        var changed = 0;
        var desired = enabled ? ToggleState.On : ToggleState.Off;

        for (var i = 0; i < checkboxes.Count; i++)
        {
            var checkbox = checkboxes[i];
            if (!IsVisibleEnabled(checkbox))
                continue;

            visible++;
            try
            {
                if (!checkbox.TryGetCurrentPattern(TogglePattern.Pattern, out var pattern) ||
                    pattern is not TogglePattern toggle)
                    continue;

                if (toggle.Current.ToggleState == desired)
                    continue;

                toggle.Toggle();
                changed++;
                Thread.Sleep(75);
            }
            catch
            {
                // One nonstandard cell should not block the rest of the strategy rows.
            }
        }

        if (visible == 0)
        {
            return new NinjaTraderStrategyToggleResult(false, 0, 0,
                "No visible strategy Enabled checkboxes were found in NinjaTrader.");
        }

        var action = enabled ? "enabled" : "disabled";
        return new NinjaTraderStrategyToggleResult(true, visible, changed,
            changed == 0
                ? $"All {visible} visible strategy row(s) were already {action}."
                : $"{action[..1].ToUpperInvariant() + action[1..]} {changed} of {visible} visible strategy row(s).");
    }

    private static NinjaTraderGridSafetySnapshot GetGridSafetySnapshot()
    {
        if (!IsNinjaTraderRunning())
        {
            return new NinjaTraderGridSafetySnapshot(
                -1, -1, -1, 0, 0, true, true, "NinjaTrader is not running.");
        }

        var desktop = AutomationElement.RootElement;
        AutomationElement? controlCenter = null;
        foreach (var process in Process.GetProcessesByName("NinjaTrader"))
        {
            var processCondition = new PropertyCondition(AutomationElement.ProcessIdProperty, process.Id);
            controlCenter = FindControlCenter(desktop, processCondition);
            if (controlCenter is not null)
                break;
        }

        if (controlCenter is null)
        {
            return new NinjaTraderGridSafetySnapshot(
                -1, -1, -1, 0, 0, true, true, "NinjaTrader Control Center was not found.");
        }

        TryBringWindowToFront(controlCenter);
        var readErrors = new List<string>();
        var orders = ReadGridItemCount(controlCenter, "OrdersGridTabItem", "OrdersGrid", readErrors);
        var positions = ReadGridItemCount(controlCenter, "PositionsGridTabItem", "PositionsGrid", readErrors);
        var strategies = ReadStrategyGridState(controlCenter, readErrors);
        var gridUncertain = orders < 0 || positions < 0 || strategies.Count < 0;
        var enabledUncertain = strategies.EnabledStateUncertain;

        return new NinjaTraderGridSafetySnapshot(
            orders,
            positions,
            strategies.Count,
            strategies.EnabledCount,
            strategies.DisabledCount,
            enabledUncertain,
            gridUncertain,
            string.Join("; ", readErrors));
    }

    private static int ReadGridItemCount(
        AutomationElement controlCenter,
        string tabAutomationId,
        string gridAutomationId,
        ICollection<string> readErrors)
    {
        if (!TrySelectTab(controlCenter, tabAutomationId))
        {
            readErrors.Add($"{gridAutomationId} tab was not found.");
            return -1;
        }

        Thread.Sleep(200);
        var grid = controlCenter.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, gridAutomationId));
        if (grid is null)
        {
            readErrors.Add($"{gridAutomationId} was not found.");
            return -1;
        }

        try
        {
            var rows = grid.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem));
            return rows.Cast<AutomationElement>().Count(IsVisible);
        }
        catch (Exception ex)
        {
            readErrors.Add($"{gridAutomationId} count failed: {ex.Message}");
            return -1;
        }
    }

    private static (int Count, int EnabledCount, int DisabledCount, bool EnabledStateUncertain) ReadStrategyGridState(
        AutomationElement controlCenter,
        ICollection<string> readErrors)
    {
        if (!TrySelectTab(controlCenter, "StrategiesGridTabItem"))
        {
            readErrors.Add("StrategiesGrid tab was not found.");
            return (-1, 0, 0, true);
        }

        Thread.Sleep(300);
        var grid = controlCenter.FindFirst(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, "StrategiesGrid"));
        if (grid is null)
        {
            readErrors.Add("StrategiesGrid was not found.");
            return (-1, 0, 0, true);
        }

        var count = -1;
        var enabled = 0;
        var disabled = 0;
        var uncertain = false;

        try
        {
            var rows = grid.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.DataItem));
            count = rows.Cast<AutomationElement>().Count(IsVisible);
        }
        catch (Exception ex)
        {
            readErrors.Add($"StrategiesGrid count failed: {ex.Message}");
        }

        try
        {
            var checkboxes = grid.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox));
            for (var i = 0; i < checkboxes.Count; i++)
            {
                var checkbox = checkboxes[i];
                if (!IsVisibleEnabled(checkbox))
                    continue;

                if (!checkbox.TryGetCurrentPattern(TogglePattern.Pattern, out var pattern) ||
                    pattern is not TogglePattern toggle)
                {
                    uncertain = true;
                    continue;
                }

                if (toggle.Current.ToggleState == ToggleState.On)
                    enabled++;
                else if (toggle.Current.ToggleState == ToggleState.Off)
                    disabled++;
                else
                    uncertain = true;
            }
        }
        catch (Exception ex)
        {
            readErrors.Add($"StrategiesGrid enabled-state read failed: {ex.Message}");
            uncertain = true;
        }

        return (count, enabled, disabled, uncertain);
    }

    private static NinjaTraderUiScanResult Scan()
    {
        var connections = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var accounts = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var sawControlCenterXml = false;
        var sawControlCenter = false;
        var selectedAccountsTab = false;
        var openedConnectionsMenu = false;
        var readLocalFiles = false;
        var sw = Stopwatch.StartNew();

        try
        {
            readLocalFiles = ScanLocalNinjaTraderFiles(connections);

            var desktop = AutomationElement.RootElement;
            foreach (var process in Process.GetProcessesByName("NinjaTrader"))
            {
                var processCondition = new PropertyCondition(AutomationElement.ProcessIdProperty, process.Id);
                var controlCenter = FindControlCenter(desktop, processCondition);
                if (controlCenter is null)
                    continue;

                sawControlCenter = true;
                ScanElement(controlCenter, connections, accounts, ref sawControlCenterXml, includeAccounts: false, maxDepth: 7);

                if (TrySelectTab(controlCenter, "AccountsGridTabItem"))
                {
                    selectedAccountsTab = true;
                    Thread.Sleep(150);
                    ScanElement(controlCenter, connections, accounts, ref sawControlCenterXml, includeAccounts: true, maxDepth: 7);
                    if (accounts.Count == 0)
                        ScanScrollableElements(controlCenter, connections, accounts, ref sawControlCenterXml, includeAccounts: true);
                }

                if (TryOpenConnectionsMenu(controlCenter))
                {
                    openedConnectionsMenu = true;
                    Thread.Sleep(150);
                    var popups = desktop.FindAll(TreeScope.Children, processCondition);
                    for (var j = 0; j < popups.Count; j++)
                        ScanElement(popups[j], connections, accounts, ref sawControlCenterXml, includeAccounts: false, maxDepth: 4);
                }

                break;
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
        if (readLocalFiles)
            detail += " Read local NinjaTrader config/log files for connection hints only.";
        if (accounts.Count == 0)
            detail += " Control Center did not expose account rows.";
        detail += $" Scan took {sw.Elapsed.TotalSeconds:0.0}s.";

        return new NinjaTraderUiScanResult(connections.ToList(), accounts.ToList(), detail);
    }

    private static bool ScanLocalNinjaTraderFiles(ISet<string> connections)
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NinjaTrader 8");
        if (!Directory.Exists(root))
            return false;

        var beforeConnections = connections.Count;
        ScanConfigXml(Path.Combine(root, "Config.xml"), connections);
        ScanRecentTextFiles(Path.Combine(root, "log"), connections);
        ScanRecentTextFiles(Path.Combine(root, "trace"), connections);
        return connections.Count != beforeConnections;
    }

    private static void ScanConfigXml(string path, ISet<string> connections)
    {
        if (!File.Exists(path))
            return;

        try
        {
            var document = XDocument.Load(path, LoadOptions.None);
            foreach (var value in document.Descendants().Where(e =>
                         e.Name.LocalName.Equals("Name", StringComparison.OrdinalIgnoreCase) ||
                         e.Name.LocalName.Equals("CachedUserOrg", StringComparison.OrdinalIgnoreCase)))
            {
                AddConnectionCandidate(value.Value, connections);
            }
        }
        catch
        {
            // Config.xml is a fallback source. If it is locked or partial, UI automation can still scan.
        }
    }

    private static void ScanRecentTextFiles(string directory, ISet<string> connections)
    {
        if (!Directory.Exists(directory))
            return;

        IEnumerable<FileInfo> files;
        try
        {
            files = new DirectoryInfo(directory)
                .EnumerateFiles("*.txt")
                .Where(f => f.Length is > 0 and < 2_000_000)
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .Take(4)
                .ToArray();
        }
        catch
        {
            return;
        }

        foreach (var file in files)
            ScanTextFile(file.FullName, connections);
    }

    private static void ScanTextFile(string path, ISet<string> connections)
    {
        try
        {
            var ignoredAccounts = new SortedSet<string>();
            foreach (var line in File.ReadLines(path).TakeLast(700))
            {
                TryScanText(line, connections, ignoredAccounts, ref UnsafeIgnoreXmlFlag.Value, includeAccounts: false);
                ExtractConnectionMentions(line, connections);
            }
        }
        catch
        {
            // Trace/log files can roll while being read.
        }
    }

    private static void ExtractConnectionMentions(string value, ISet<string> connections)
    {
        if (string.IsNullOrWhiteSpace(value))
            return;

        foreach (Match match in Regex.Matches(value, @"\((?<name>Apex|Lucid|Topstep|Take Profit|MyFundedFutures|Tradeify|Earn2Trade|BluSky|TickTickTrader|NinjaTrader)\)", RegexOptions.IgnoreCase))
            AddConnectionCandidate(match.Groups["name"].Value, connections);

        foreach (Match match in Regex.Matches(value, @"Auto connecting '(?<name>[^']+)'", RegexOptions.IgnoreCase))
            AddConnectionCandidate(match.Groups["name"].Value, connections);

        foreach (Match match in Regex.Matches(value, @"\|(?<name>Apex|Lucid|Topstep|Take Profit|MyFundedFutures|Tradeify|Earn2Trade|BluSky|TickTickTrader|NinjaTrader): Primary connection=", RegexOptions.IgnoreCase))
            AddConnectionCandidate(match.Groups["name"].Value, connections);
    }

    private static void AddConnectionCandidate(string value, ISet<string> connections)
    {
        var cleaned = NormalizeConnectionName(value);
        if (!string.IsNullOrWhiteSpace(cleaned))
            connections.Add(cleaned);
    }

    private static string? NormalizeConnectionName(string value)
    {
        var cleaned = value.Trim();
        if (string.IsNullOrWhiteSpace(cleaned))
            return null;

        return cleaned.Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant() switch
        {
            "APEX" or "APEXTRADERFUNDING" => "Apex",
            "LUCID" or "LUCIDTRADING" => "Lucid",
            "TOPSTEP" => "Topstep",
            "TAKEPROFIT" => "Take Profit",
            "MYFUNDEDFUTURES" => "MyFundedFutures",
            "TRADEIFY" => "Tradeify",
            "EARN2TRADE" => "Earn2Trade",
            "BLUSKY" => "BluSky",
            "TICKTICKTRADER" => "TickTickTrader",
            "NINJATRADER" => "NinjaTrader",
            _ => ConnectionPattern.IsMatch(cleaned) ? cleaned : null
        };
    }

    private static class UnsafeIgnoreXmlFlag
    {
        [ThreadStatic]
        public static bool Value;
    }

    private static AutomationElement? FindControlCenter(AutomationElement desktop, PropertyCondition processCondition)
    {
        var windows = desktop.FindAll(TreeScope.Children, processCondition);
        for (var i = 0; i < windows.Count; i++)
        {
            var window = windows[i];
            if (LooksLikeControlCenter(window) || ContainsControlCenterControls(window))
                return window;
        }

        for (var i = 0; i < windows.Count; i++)
        {
            var nested = FindNestedControlCenter(windows[i]);
            if (nested is not null)
                return nested;
        }

        return null;
    }

    private static AutomationElement? FindNestedControlCenter(AutomationElement window)
    {
        try
        {
            var condition = new OrCondition(
                new PropertyCondition(AutomationElement.AutomationIdProperty, "ControlCenter"),
                new PropertyCondition(AutomationElement.ClassNameProperty, "ControlCenter"),
                new PropertyCondition(AutomationElement.AutomationIdProperty, "ControlCenterMenuItemConnections"),
                new PropertyCondition(AutomationElement.AutomationIdProperty, "AccountsGridTabItem"),
                new PropertyCondition(AutomationElement.AutomationIdProperty, "StrategiesGridTabItem"));
            return window.FindFirst(TreeScope.Descendants, condition);
        }
        catch
        {
            return null;
        }
    }

    private static bool LooksLikeControlCenter(AutomationElement element)
    {
        var automationId = GetAutomationId(element);
        var className = GetClassName(element);
        var name = GetName(element);

        return automationId.Equals("ControlCenter", StringComparison.OrdinalIgnoreCase)
               || className.Equals("ControlCenter", StringComparison.OrdinalIgnoreCase)
               || name.Contains("Control Center", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ContainsControlCenterControls(AutomationElement element)
    {
        try
        {
            var condition = new OrCondition(
                new PropertyCondition(AutomationElement.AutomationIdProperty, "ControlCenterMenuItemConnections"),
                new PropertyCondition(AutomationElement.AutomationIdProperty, "AccountsGridTabItem"),
                new PropertyCondition(AutomationElement.AutomationIdProperty, "StrategiesGridTabItem"));
            return element.FindFirst(TreeScope.Descendants, condition) is not null;
        }
        catch
        {
            return false;
        }
    }

    private static bool TrySelectTab(AutomationElement root, string automationId)
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

    private static void TryBringWindowToFront(AutomationElement element)
    {
        try
        {
            var current = element;
            for (var i = 0; i < 8; i++)
            {
                if (current.Current.ControlType == ControlType.Window)
                    break;

                var parent = TreeWalker.ControlViewWalker.GetParent(current);
                if (parent is null)
                    break;
                current = parent;
            }

            if (current.TryGetCurrentPattern(WindowPattern.Pattern, out var pattern) &&
                pattern is WindowPattern window)
            {
                if (window.Current.WindowVisualState == WindowVisualState.Minimized)
                    window.SetWindowVisualState(WindowVisualState.Normal);
            }

            current.SetFocus();
        }
        catch
        {
            // Foreground focus is helpful but not required for UI Automation patterns.
        }
    }

    private static bool IsVisibleEnabled(AutomationElement element)
    {
        try
        {
            return element.Current.IsEnabled && !element.Current.BoundingRectangle.IsEmpty;
        }
        catch
        {
            return false;
        }
    }

    private static bool IsVisible(AutomationElement element)
    {
        try
        {
            return !element.Current.BoundingRectangle.IsEmpty;
        }
        catch
        {
            return false;
        }
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

    private static void ScanScrollableElements(
        AutomationElement root,
        ISet<string> connections,
        ISet<string> accounts,
        ref bool sawControlCenterXml,
        bool includeAccounts)
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

        var scrollablesScanned = 0;
        for (var i = 0; i < elements.Count && scrollablesScanned < 3; i++)
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
                    Thread.Sleep(75);
                }
                catch
                {
                    // Some NinjaTrader grids expose ScrollPattern but refuse direct percent setting.
                }

                scrollablesScanned++;
                var previous = double.NaN;
                for (var n = 0; n < 8; n++)
                {
                    var previousAccountCount = accounts.Count;
                    var previousConnectionCount = connections.Count;
                    ScanElement(root, connections, accounts, ref sawControlCenterXml, includeAccounts, maxDepth: 6);
                    var current = scroll.Current.VerticalScrollPercent;
                    if (!double.IsNaN(previous) && Math.Abs(current - previous) < 0.01)
                        break;
                    if (accounts.Count == previousAccountCount && connections.Count == previousConnectionCount && n >= 2)
                        break;
                    previous = current;
                    scroll.Scroll(ScrollAmount.NoAmount, ScrollAmount.LargeIncrement);
                    Thread.Sleep(75);
                }
            }
            catch
            {
                // Scrolling is best-effort discovery; one bad control should not stop scanning.
            }
        }
    }

    private static void ScanElement(
        AutomationElement element,
        ISet<string> connections,
        ISet<string> accounts,
        ref bool sawControlCenterXml,
        bool includeAccounts,
        int depth = 0,
        int maxDepth = 10)
    {
        if (depth > maxDepth)
            return;

        TryScanText(GetName(element), connections, accounts, ref sawControlCenterXml, includeAccounts);
        TryScanText(GetValue(element), connections, accounts, ref sawControlCenterXml, includeAccounts);

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
            ScanElement(children[i], connections, accounts, ref sawControlCenterXml, includeAccounts, depth + 1, maxDepth);
    }

    private static void TryScanText(
        string value,
        ISet<string> connections,
        ISet<string> accounts,
        ref bool sawControlCenterXml,
        bool includeAccounts)
    {
        if (string.IsNullOrWhiteSpace(value))
            return;

        if (value.Contains("<NinjaTrader>", StringComparison.OrdinalIgnoreCase))
        {
            sawControlCenterXml = true;
            TryReadControlCenterXml(value, connections);
        }

        if (includeAccounts)
        {
            foreach (Match match in AccountPattern.Matches(value))
                accounts.Add(match.Value.Trim());
        }

        AddConnectionCandidate(value, connections);
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
            // Partial Control Center XML should not break discovery.
        }
    }

    private static string GetName(AutomationElement element)
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

    private static string GetAutomationId(AutomationElement element)
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

    private static string GetClassName(AutomationElement element)
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

    private static string GetValue(AutomationElement element)
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
}
