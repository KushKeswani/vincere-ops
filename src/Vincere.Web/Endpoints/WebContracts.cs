using Vincere.Ipc.Contract;

namespace Vincere.Web.Endpoints;

/// <summary>Body for guarded actions (enable-all, flatten, ready-run, stack-apply).</summary>
public sealed record GuardedRequest(string? Confirm);

/// <summary>Body for stack apply.</summary>
public sealed record StackApplyRequest(Guid AccountId, string? PeriodFilter, string? Confirm);

/// <summary>Body for schedule config updates.</summary>
public sealed record ScheduleUpdateRequest(bool? Enabled, string? Time, bool? EnableStrategies, string? Confirm);

/// <summary>Body for blueprint import: raw-account -> existing account Guid mapping.</summary>
public sealed record BlueprintImportRequest(
    Dictionary<string, Guid>? Mappings,
    bool ReplaceExisting);

internal static class WebHelpers
{
    /// <summary>Mask an account number to its last 4 chars. Never emit full trading account IDs.</summary>
    public static string MaskAccount(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return "";
        var t = raw.Trim();
        return t.Length <= 4 ? new string('•', t.Length) : "…" + t[^4..];
    }

    /// <summary>Project an IPC response into a serializable shape, passing the add-on payload through.</summary>
    public static object Project(IpcResponse? res)
    {
        if (res is null)
            return new { ok = false, message = "No response from NinjaTrader add-on (is it running on this machine?)" };

        return new
        {
            ok = res.Ok,
            message = res.Message,
            payload = res.Payload
        };
    }
}
