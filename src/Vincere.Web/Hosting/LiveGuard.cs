using Vincere.Core.Infrastructure;

namespace Vincere.Web.Hosting;

/// <summary>
/// The hard safety boundary for commands that touch live orders/positions/strategies
/// (ENABLE_ALL_STRATEGIES, APPLY_STACK, FLATTEN_ALL/ACCOUNT and the ready-run enable path).
/// A guarded action may fire live ONLY when all three hold:
///   1. DRY_RUN is false (bridge would otherwise simulate),
///   2. the caller sent confirm == "LIVE" in the request body,
///   3. the server-side allowlist VINCERE_WEB_ALLOW_LIVE is true (default false).
/// Until then the action runs in dry-run/simulated mode. This is the human-approval
/// substitute while web auth is deferred; see plan + AGENT_HANDOFF safety rules.
/// </summary>
public sealed class LiveGuard
{
    public const string KeyAllowLive = "VINCERE_WEB_ALLOW_LIVE";
    public const string LiveConfirmToken = "LIVE";

    private readonly AppRuntimeConfig _config;
    private readonly AppSettingsProvider _settings;

    public LiveGuard(AppRuntimeConfig config, AppSettingsProvider settings)
    {
        _config = config;
        _settings = settings;
    }

    /// <summary>Server-side allowlist flag. Default false so live firing is off unless explicitly enabled.</summary>
    public bool AllowLiveConfigured => _settings.TryGetBool(KeyAllowLive, false);

    /// <summary>
    /// Decide whether a guarded action may fire live. Returns Allowed=false with a reason
    /// when any gate fails; callers then run in dry-run and surface the reason.
    /// </summary>
    public LiveDecision Evaluate(string? confirm)
    {
        if (_config.DryRun)
            return LiveDecision.Blocked("DRY_RUN is enabled — command simulated, nothing sent to NinjaTrader.");

        if (!AllowLiveConfigured)
            return LiveDecision.Blocked($"Live firing is disabled ({KeyAllowLive} is not true) — refused, nothing sent to NinjaTrader.");

        if (!string.Equals(confirm, LiveConfirmToken, StringComparison.Ordinal))
            return LiveDecision.Blocked($"Missing live confirmation (send \"confirm\":\"{LiveConfirmToken}\") — refused, nothing sent to NinjaTrader.");

        return LiveDecision.Allow();
    }
}

public readonly record struct LiveDecision(bool Allowed, string? Reason)
{
    public static LiveDecision Allow() => new(true, null);
    public static LiveDecision Blocked(string reason) => new(false, reason);
}
