namespace Vincere.Core.Infrastructure;

/// <summary>
/// Locates NinjaTrader 8 folders under Windows <c>Documents</c> / OneDrive (same idea as Install-VincereAddon.ps1).
/// Actual layout: <c>...\Documents\NinjaTrader 8\templates\...</c> holds template XML across subfolders.
/// </summary>
public static class NinjaTraderInstallationPaths
{
    /// <returns>Distinct existing paths ending in ...\NinjaTrader 8</returns>
    public static IReadOnlyList<string> EnumerateNinjaTrader8RootDirectories()
    {
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void TryNt8Under(string? baseFolder)
        {
            if (string.IsNullOrWhiteSpace(baseFolder)) return;
            var trimmed = baseFolder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var nt8 = Path.Combine(trimmed, "NinjaTrader 8");
            try
            {
                if (Directory.Exists(nt8))
                    roots.Add(Path.GetFullPath(nt8));
            }
            catch
            {
                /* ignore */
            }
        }

        TryNt8Under(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
        TryNt8Under(Environment.GetFolderPath(Environment.SpecialFolder.Personal));

        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        TryNt8Under(Path.Combine(profile, "Documents"));

        var od = Path.Combine(profile, "OneDrive");
        TryNt8Under(Path.Combine(od, "Documents"));

        try
        {
            if (Directory.Exists(profile))
            {
                foreach (var dir in Directory.EnumerateDirectories(profile, "OneDrive*",
                             SearchOption.TopDirectoryOnly))
                    TryNt8Under(Path.Combine(dir, "Documents"));
            }
        }
        catch
        {
            /* ignore */
        }

        return roots.OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    /// <summary>Each existing <c>NinjaTrader 8\templates</c> folder (recursive XML scan happens elsewhere).</summary>
    public static IEnumerable<string> EnumerateTemplatesRootDirectories()
    {
        foreach (var root in EnumerateNinjaTrader8RootDirectories())
        {
            var templates = Path.Combine(root, "templates");
            if (Directory.Exists(templates))
                yield return templates;
        }
    }
}
