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
    public const string KeyDeveloperPasscode = "DEVELOPER_PASSCODE";
    public const string KeyConnectionRefreshTime = "CONNECTION_REFRESH_TIME";
    public const string KeyEnableAllTime = "ENABLE_ALL_STRATEGIES_TIME";
    public const string KeyEodTime = "EOD_CUTOFF_TIME";
    public const string KeyNtTemplateChoices = "NT_TEMPLATE_CHOICES";
    public const string KeyNtTemplateDirsExtra = "NT_TEMPLATE_DIRS_EXTRA";
    public const string KeyNtTemplateScanExtraOnly = "NT_TEMPLATE_SCAN_EXTRA_ONLY";
    public const string KeyIpcConnectTimeoutMs = "VINCERE_IPC_CONNECT_MS";
    public const string KeyIpcRetryAttempts = "VINCERE_IPC_RETRY_ATTEMPTS";
    public const string KeyIpcRetryDelayMs = "VINCERE_IPC_RETRY_DELAY_MS";

    private readonly AppSettingsProvider _provider;

    public AppRuntimeConfig(AppSettingsProvider provider) => _provider = provider;

    public string? TelegramBotToken => _provider.Get(KeyTelegramBotToken);
    public string? TelegramChatId => _provider.Get(KeyTelegramChatId);
    public string DataDirectory => _provider.Get(KeyDataDir) ?? AppPaths.RootDataDirectory;
    public string NinjaTraderLogDirectory => _provider.Get(KeyNtLogDir) ?? AppPaths.DefaultNinjaTraderLogRoot();
    public string IpcPipeName => _provider.Get(KeyIpcPipeName) ?? "VincereOperator";
    public bool DryRun => _provider.TryGetBool(KeyDryRun, false);
    public string? PropConnectionName => _provider.Get(KeyPropConnectionName);
    public string EffectiveDeveloperPasscode => _provider.Get(KeyDeveloperPasscode) ?? "091209";
    public TimeOnly ConnectionRefreshTime => ParseTime(_provider.Get(KeyConnectionRefreshTime), new TimeOnly(8, 20));
    public TimeOnly EnableAllStrategiesTime => ParseTime(_provider.Get(KeyEnableAllTime), new TimeOnly(8, 25));
    public TimeOnly EodCutoffTime => ParseTime(_provider.Get(KeyEodTime), new TimeOnly(16, 5));

    /// <summary>Comma-separated template names for stack editor dropdown (optional).</summary>
    public IReadOnlyList<string> NtTemplateChoiceList =>
        ParseCommaList(_provider.Get(KeyNtTemplateChoices));

    /// <summary>Extra semicolon-separated folders to scan for <c>*.xml</c> template names (in addition to auto NT paths unless <see cref="NtTemplateScanExclusiveExtraOnly"/>).</summary>
    public IReadOnlyList<string> NtTemplateDirsExtra =>
        ParseSemicolonList(_provider.Get(KeyNtTemplateDirsExtra));

    /// <summary>If true, only <see cref="NtTemplateDirsExtra"/> are scanned (no auto Documents\NinjaTrader 8\templates).</summary>
    public bool NtTemplateScanExclusiveExtraOnly =>
        _provider.TryGetBool(KeyNtTemplateScanExtraOnly, false);

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
}
