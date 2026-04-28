using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vincere.Ipc.Contract;

public sealed class IpcRequest
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [JsonPropertyName("command")]
    public string Command { get; set; } = "";

    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; set; }
}

public sealed class IpcResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; set; }
}

public static class IpcCommands
{
    public const string GetStatus = "GET_STATUS";
    public const string EnableAllStrategies = "ENABLE_ALL_STRATEGIES";
    public const string DisableAllStrategies = "DISABLE_ALL_STRATEGIES";
    public const string RefreshConnection = "REFRESH_CONNECTION";
    public const string DisconnectConnection = "DISCONNECT_CONNECTION";
    public const string ApplyStack = "APPLY_STACK";
    public const string Ping = "PING";
}
