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

    private static TimeOnly ParseTime(string? value, TimeOnly fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
            return fallback;
        return TimeOnly.TryParse(value, out var t) ? t : fallback;
    }
}
