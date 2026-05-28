namespace Vincere.Core.Infrastructure;

/// <summary>Typed view of merged env after <see cref="AppSettingsProvider.Reload"/>.</summary>
public sealed class AppRuntimeConfig
{
    public const string KeyTelegramBotToken = "TELEGRAM_BOT_TOKEN";
    public const string KeyTelegramChatId = "TELEGRAM_CHAT_ID";
    public const string KeyDataDir = "DATA_DIR";
    public const string KeyNtLogDir = "NT_LOG_DIR";
    public const string KeyIpcPipeName = "VINCERE_IPC_PIPE_NAME";
    public const string KeyDryRun = "DRY_RUN";
    public const string KeyPropConnectionName = "PROP_CONNECTION_NAME";
    public const string KeyPropFirm = "PROP_FIRM";
    public const string KeyAccountType = "ACCOUNT_TYPE";
    public const string KeyTradingPlatform = "TRADING_PLATFORM";
    public const string KeyConnectionRefreshTime = "CONNECTION_REFRESH_TIME";
    public const string KeyStackApplyTime = "STACK_APPLY_TIME";
    public const string KeyAutoApplyStacks = "AUTO_APPLY_STACKS";
    public const string KeyEnableAllTime = "ENABLE_ALL_STRATEGIES_TIME";
    public const string KeyReadyAlgosScheduleEnabled = "READY_ALGOS_SCHEDULE_ENABLED";
    public const string KeyReadyAlgosTime = "READY_ALGOS_TIME";
    public const string KeyReadyAlgosEnableStrategies = "READY_ALGOS_ENABLE_STRATEGIES";
    public const string KeyUseUiStrategyToggle = "VINCERE_USE_UI_STRATEGY_TOGGLE";
    public const string KeyAccountCyclingEnabled = "ACCOUNT_CYCLING_ENABLED";
    public const string KeyAccountCyclingStartDate = "ACCOUNT_CYCLING_START_DATE";
    public const string KeyAccountCyclingIntervalDays = "ACCOUNT_CYCLING_INTERVAL_DAYS";
    public const string KeyEodTime = "EOD_CUTOFF_TIME";
    public const string KeyCloseAllBeforeEod = "CLOSE_ALL_BEFORE_EOD";
    public const string KeyCloseAllTime = "CLOSE_ALL_TIME";
    public const string KeyAvoidOvernightHolds = "AVOID_OVERNIGHT_HOLDS";
    public const string KeyDailyLossLimit = "DAILY_LOSS_LIMIT";
    public const string KeyDailyProfitLimit = "DAILY_PROFIT_LIMIT";
    public const string KeyUnrealizedLossLimit = "UNREALIZED_LOSS_LIMIT";
    public const string KeyUnrealizedProfitLimit = "UNREALIZED_PROFIT_LIMIT";
    public const string KeyRiskLimitScope = "RISK_LIMIT_SCOPE";
    public const string KeyNtTemplateChoices = "NT_TEMPLATE_CHOICES";
    public const string KeyNtTemplateDirsExtra = "NT_TEMPLATE_DIRS_EXTRA";
    public const string KeyNtTemplateScanExtraOnly = "NT_TEMPLATE_SCAN_EXTRA_ONLY";
    public const string KeyEnableNtUiStackSetup = "VINCERE_ENABLE_NT_UI_STACK_SETUP";
    public const string KeyIpcConnectTimeoutMs = "VINCERE_IPC_CONNECT_MS";
    public const string KeyIpcRetryAttempts = "VINCERE_IPC_RETRY_ATTEMPTS";
    public const string KeyIpcRetryDelayMs = "VINCERE_IPC_RETRY_DELAY_MS";
    public const string KeyNtHealthAutoReconnect = "NT_HEALTH_AUTO_RECONNECT";
    public const string KeyNtHealthReconnectCooldownMinutes = "NT_HEALTH_RECONNECT_COOLDOWN_MINUTES";
    public const string KeyNtHealthPollSeconds = "NT_HEALTH_POLL_SECONDS";
    public const string KeyLicenseKey = "VINCERE_LICENSE_KEY";
    public const string KeyLicenseVerified = "VINCERE_LICENSE_VERIFIED";
    public const string KeyLicenseStatus = "VINCERE_LICENSE_STATUS";
    public const string KeyLicenseVerifiedAt = "VINCERE_LICENSE_VERIFIED_AT";
    public const string KeyLicenseApiUrl = "VINCERE_LICENSE_API_URL";
    public const string KeyLicenseTestMode = "VINCERE_LICENSE_TEST_MODE";
    public const string KeyNinjaTraderAutoLoginEnabled = "NT_AUTO_LOGIN_ENABLED";
    public const string KeyNinjaTraderLoginUsername = "NT_LOGIN_USERNAME";
    public const string KeyNinjaTraderLoginPasswordProtected = "NT_LOGIN_PASSWORD_DPAPI";
    public const string KeyNinjaTraderScheduledResetEnabled = "NT_SCHEDULED_RESET_ENABLED";
    public const string KeyNinjaTraderResetIntervalDays = "NT_RESET_INTERVAL_DAYS";

    private readonly AppSettingsProvider _provider;

    public AppRuntimeConfig(AppSettingsProvider provider) => _provider = provider;

    public string? TelegramBotToken => _provider.Get(KeyTelegramBotToken);
    public string? TelegramChatId => _provider.Get(KeyTelegramChatId);
    public string DataDirectory => _provider.Get(KeyDataDir) ?? AppPaths.RootDataDirectory;
    public string NinjaTraderLogDirectory => _provider.Get(KeyNtLogDir) ?? AppPaths.DefaultNinjaTraderLogRoot();
    public string IpcPipeName => _provider.Get(KeyIpcPipeName) ?? "VincereOperator";
    public bool DryRun => _provider.TryGetBool(KeyDryRun, false);
    public string? PropConnectionName => _provider.Get(KeyPropConnectionName);
    public string? PropFirm => _provider.Get(KeyPropFirm);
    public string? AccountType => _provider.Get(KeyAccountType);
    public string? TradingPlatform => _provider.Get(KeyTradingPlatform);
    public TimeOnly ConnectionRefreshTime => ParseTime(_provider.Get(KeyConnectionRefreshTime), new TimeOnly(8, 20));
    public TimeOnly StackApplyTime => ParseTime(_provider.Get(KeyStackApplyTime), new TimeOnly(8, 23));
    public bool AutoApplyStacks => _provider.TryGetBool(KeyAutoApplyStacks, true);
    public TimeOnly EnableAllStrategiesTime => ParseTime(_provider.Get(KeyEnableAllTime), new TimeOnly(8, 25));
    public bool ReadyAlgosScheduleEnabled => _provider.TryGetBool(KeyReadyAlgosScheduleEnabled, false);
    public TimeOnly ReadyAlgosTime => ParseTime(_provider.Get(KeyReadyAlgosTime), new TimeOnly(8, 0));
    public bool ReadyAlgosEnableStrategies => _provider.TryGetBool(KeyReadyAlgosEnableStrategies, false);
    public bool UseUiStrategyToggle => _provider.TryGetBool(KeyUseUiStrategyToggle, true);
    public bool AccountCyclingEnabled => _provider.TryGetBool(KeyAccountCyclingEnabled, true);
    public DateOnly? AccountCyclingStartDate => DateOnly.TryParse(_provider.Get(KeyAccountCyclingStartDate), out var d) ? d : null;
    public int AccountCyclingIntervalDays
    {
        get
        {
            var v = _provider.Get(KeyAccountCyclingIntervalDays);
            if (int.TryParse(v, out var days) && days >= 1 && days <= 90)
                return days;
            return 14;
        }
    }
    public TimeOnly EodCutoffTime => ParseTime(_provider.Get(KeyEodTime), new TimeOnly(16, 5));
    public bool CloseAllBeforeEod => _provider.TryGetBool(KeyCloseAllBeforeEod, false);
    public TimeOnly CloseAllTime => ParseTime(_provider.Get(KeyCloseAllTime), new TimeOnly(16, 55));
    public bool AvoidOvernightHolds => _provider.TryGetBool(KeyAvoidOvernightHolds, true);
    public decimal? DailyLossLimit => ParseDecimal(_provider.Get(KeyDailyLossLimit));
    public decimal? DailyProfitLimit => ParseDecimal(_provider.Get(KeyDailyProfitLimit));
    public decimal? UnrealizedLossLimit => ParseDecimal(_provider.Get(KeyUnrealizedLossLimit));
    public decimal? UnrealizedProfitLimit => ParseDecimal(_provider.Get(KeyUnrealizedProfitLimit));
    public string RiskLimitScope => _provider.Get(KeyRiskLimitScope) ?? "Account";

    /// <summary>Comma-separated template names for stack editor dropdown (optional).</summary>
    public IReadOnlyList<string> NtTemplateChoiceList =>
        ParseCommaList(_provider.Get(KeyNtTemplateChoices));

    /// <summary>Extra semicolon-separated folders to scan for <c>*.xml</c> template names (in addition to auto NT paths unless <see cref="NtTemplateScanExclusiveExtraOnly"/>).</summary>
    public IReadOnlyList<string> NtTemplateDirsExtra =>
        ParseSemicolonList(_provider.Get(KeyNtTemplateDirsExtra));

    /// <summary>If true, only <see cref="NtTemplateDirsExtra"/> are scanned (no auto Documents\NinjaTrader 8\templates).</summary>
    public bool NtTemplateScanExclusiveExtraOnly =>
        _provider.TryGetBool(KeyNtTemplateScanExtraOnly, false);

    /// <summary>Attach strategies by driving the NinjaTrader Control Center Strategies UI.</summary>
    public bool EnableNtUiStackSetup => _provider.TryGetBool(KeyEnableNtUiStackSetup, true);

    /// <summary>Named-pipe connect timeout per attempt when talking to the NT add-on.</summary>
    public int IpcConnectTimeoutMs
    {
        get
        {
            var v = _provider.Get(KeyIpcConnectTimeoutMs);
            if (int.TryParse(v, out var ms) && ms >= 500 && ms <= 120_000)
                return ms;
            return 20_000;
        }
    }

    /// <summary>Total connection attempts (pipe busy / RDP jitter). Default 8.</summary>
    public int IpcRetryAttempts
    {
        get
        {
            var v = _provider.Get(KeyIpcRetryAttempts);
            if (int.TryParse(v, out var n) && n >= 1 && n <= 50)
                return n;
            return 8;
        }
    }

    /// <summary>Pause between retries (ms). Default 400.</summary>
    public int IpcRetryDelayMs
    {
        get
        {
            var v = _provider.Get(KeyIpcRetryDelayMs);
            if (int.TryParse(v, out var ms) && ms >= 0 && ms <= 30_000)
                return ms;
            return 400;
        }
    }

    /// <summary>If true, NT log disconnect/chart-freeze symptoms trigger PROP_CONNECTION_NAME refresh.</summary>
    public bool NtHealthAutoReconnect => _provider.TryGetBool(KeyNtHealthAutoReconnect, true);
    public string? LicenseKey => _provider.Get(KeyLicenseKey);
    public bool LicenseVerified => _provider.TryGetBool(KeyLicenseVerified, false);
    public string? LicenseStatus => _provider.Get(KeyLicenseStatus);
    public DateTimeOffset? LicenseVerifiedAt => DateTimeOffset.TryParse(_provider.Get(KeyLicenseVerifiedAt), out var ts) ? ts : null;
    public string? LicenseApiUrl => _provider.Get(KeyLicenseApiUrl);
    public bool LicenseTestMode => _provider.TryGetBool(KeyLicenseTestMode, false);
    public bool NinjaTraderAutoLoginEnabled => _provider.TryGetBool(KeyNinjaTraderAutoLoginEnabled, false);
    public string? NinjaTraderLoginUsername => _provider.Get(KeyNinjaTraderLoginUsername);
    public string? NinjaTraderLoginPasswordProtected => _provider.Get(KeyNinjaTraderLoginPasswordProtected);
    public bool NinjaTraderScheduledResetEnabled => _provider.TryGetBool(KeyNinjaTraderScheduledResetEnabled, false);

    public int NinjaTraderResetIntervalDays
    {
        get
        {
            var v = _provider.Get(KeyNinjaTraderResetIntervalDays);
            if (int.TryParse(v, out var days) && days >= 1 && days <= 90)
                return days;
            return 7;
        }
    }

    /// <summary>Minimum minutes between automatic reconnects to avoid churn during noisy outages.</summary>
    public int NtHealthReconnectCooldownMinutes
    {
        get
        {
            var v = _provider.Get(KeyNtHealthReconnectCooldownMinutes);
            if (int.TryParse(v, out var minutes) && minutes >= 1 && minutes <= 120)
                return minutes;
            return 5;
        }
    }

    /// <summary>Polling fallback because FileSystemWatcher can miss NT log writes over RDP/VPS disk jitter.</summary>
    public int NtHealthPollSeconds
    {
        get
        {
            var v = _provider.Get(KeyNtHealthPollSeconds);
            if (int.TryParse(v, out var seconds) && seconds >= 5 && seconds <= 300)
                return seconds;
            return 15;
        }
    }

    private static IReadOnlyList<string> ParseCommaList(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return Array.Empty<string>();
        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? Array.Empty<string>() : parts.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static IReadOnlyList<string> ParseSemicolonList(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return Array.Empty<string>();
        var parts = raw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? Array.Empty<string>() : parts.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static TimeOnly ParseTime(string? value, TimeOnly fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
            return fallback;
        return TimeOnly.TryParse(value, out var t) ? t : fallback;
    }

    private static decimal? ParseDecimal(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var cleaned = value.Trim().Replace("$", "", StringComparison.Ordinal).Replace(",", "", StringComparison.Ordinal);
        return decimal.TryParse(cleaned, out var d) ? d : null;
    }
}
