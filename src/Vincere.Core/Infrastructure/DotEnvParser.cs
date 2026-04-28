namespace Vincere.Core.Infrastructure;

/// <summary>Parses KEY=VALUE lines; # comments; optional "value" quotes. No passcode logging here.</summary>
public static class DotEnvParser
{
    public static IReadOnlyDictionary<string, string> ParseFile(string path)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path))
            return dict;

        foreach (var line in File.ReadAllLines(path))
        {
            var t = line.Trim();
            if (t.Length == 0 || t.StartsWith('#'))
                continue;
            var eq = t.IndexOf('=');
            if (eq <= 0)
                continue;
            var key = t[..eq].Trim();
            var val = t[(eq + 1)..].Trim();
            if (val.Length >= 2 && val[0] == '"' && val[^1] == '"')
                val = val[1..^1].Replace("\\\"", "\"", StringComparison.Ordinal);
            if (key.Length > 0)
                dict[key] = val;
        }
        return dict;
    }

    public static void WriteFile(string path, IReadOnlyDictionary<string, string> values)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        using var sw = new StreamWriter(path, false);
        sw.WriteLine("# Vincere Operator — do not commit. Regenerated from Developer UI or manual edit.");
        foreach (var kv in values.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(kv.Value))
                continue;
            var escaped = kv.Value.Replace("\"", "\\\"", StringComparison.Ordinal);
            if (escaped.Any(c => c is ' ' or '#' or '=') || escaped != kv.Value)
                sw.WriteLine($"{kv.Key}=\"{escaped}\"");
            else
                sw.WriteLine($"{kv.Key}={escaped}");
        }
    }
}
