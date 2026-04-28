using System.Collections;

namespace Vincere.Core.Infrastructure;

/// <summary>
/// Loads .env from <see cref="AppPaths.EnvFilePath"/>, then applies Windows environment variable overrides (higher precedence).
/// </summary>
public sealed class AppSettingsProvider
{
    public IReadOnlyDictionary<string, string> Merged { get; private set; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public void Reload()
    {
        var fromFile = DotEnvParser.ParseFile(AppPaths.EnvFilePath);
        var merged = new Dictionary<string, string>(fromFile, StringComparer.OrdinalIgnoreCase);

        foreach (DictionaryEntry e in Environment.GetEnvironmentVariables())
        {
            if (e.Key is not string key)
                continue;
            if (key.Length == 0)
                continue;
            if (e.Value is not string s)
                continue;
            merged[key] = s;
        }

        Merged = merged;
    }

    public string? Get(string key) => Merged.TryGetValue(key, out var v) ? v : null;

    public bool TryGetBool(string key, bool defaultValue = false)
    {
        var v = Get(key);
        if (string.IsNullOrWhiteSpace(v))
            return defaultValue;
        return v.Equals("true", StringComparison.OrdinalIgnoreCase) || v == "1" || v.Equals("yes", StringComparison.OrdinalIgnoreCase);
    }

    public void UpdateAndSaveEnvFile(IReadOnlyDictionary<string, string> values)
    {
        DotEnvParser.WriteFile(AppPaths.EnvFilePath, values);
        Reload();
    }
}
