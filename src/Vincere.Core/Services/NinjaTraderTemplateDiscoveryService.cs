using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;

namespace Vincere.Core.Services;

/// <summary>
/// Lists strategy/chart-style template names by scanning <c>*.xml</c> under NinjaTrader's <c>templates</c> tree
/// (e.g. <c>Documents\NinjaTrader 8\templates\bin\custom\strategy\</c> and siblings).
/// </summary>
public sealed class NinjaTraderTemplateDiscoveryService
{
    private readonly ILogger<NinjaTraderTemplateDiscoveryService> _logger;

    public NinjaTraderTemplateDiscoveryService(ILogger<NinjaTraderTemplateDiscoveryService> logger) =>
        _logger = logger;

    /// <summary>
    /// Returns file names without extension for every <c>*.xml</c> found under configured / discovered template roots.
    /// </summary>
    public IReadOnlyList<string> DiscoverXmlTemplateNames(AppRuntimeConfig config)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var dir in GetTemplateScanRoots(config))
        {
            try
            {
                if (!Directory.Exists(dir))
                    continue;

                foreach (var file in Directory.EnumerateFiles(dir, "*.xml", SearchOption.AllDirectories))
                {
                    var fn = Path.GetFileNameWithoutExtension(file);
                    if (!string.IsNullOrWhiteSpace(fn))
                        names.Add(fn);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Skipped template scan for {Dir}", dir);
            }
        }

        return names.OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static IEnumerable<string> GetTemplateScanRoots(AppRuntimeConfig config)
    {
        foreach (var extra in config.NtTemplateDirsExtra)
        {
            if (!string.IsNullOrWhiteSpace(extra))
            {
                var p = extra.Trim();
                if (Directory.Exists(p))
                    yield return p;
            }
        }

        if (config.NtTemplateScanExclusiveExtraOnly)
            yield break;

        foreach (var t in NinjaTraderInstallationPaths.EnumerateTemplatesRootDirectories())
            yield return t;
    }
}
