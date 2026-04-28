using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;

namespace Vincere.Core.Services;

/// <summary>
/// Watches NT log folder for disconnect / freeze patterns. Fires callback; no passcode logging.
/// </summary>
public sealed class NtLogHealthWatcher : IDisposable
{
    private static readonly Regex[] AlertPatterns =
    {
        new("disconnect", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new("connection.*lost", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new("freeze|stalled|no data", RegexOptions.IgnoreCase | RegexOptions.Compiled),
    };

    private readonly AppRuntimeConfig _config;
    private readonly ILogger<NtLogHealthWatcher> _logger;
    private FileSystemWatcher? _watcher;
    private readonly string _dir;
    private long _lastPos;

    public event EventHandler<string>? Alert;

    public NtLogHealthWatcher(AppRuntimeConfig config, ILogger<NtLogHealthWatcher> logger)
    {
        _config = config;
        _logger = logger;
        _dir = config.NinjaTraderLogDirectory;
    }

    public void Start()
    {
        try
        {
            if (!Directory.Exists(_dir))
            {
                _logger.LogWarning("NT log dir missing: {Dir}", _dir);
                return;
            }

            _watcher = new FileSystemWatcher(_dir, "*.txt")
            {
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName,
                IncludeSubdirectories = false,
                EnableRaisingEvents = true
            };
            _watcher.Changed += OnChanged;
            _watcher.Created += OnChanged;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not start NT log watcher");
        }
    }

    private void OnChanged(object sender, FileSystemEventArgs e)
    {
        try
        {
            if (!File.Exists(e.FullPath))
                return;
            using var fs = new FileStream(e.FullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            if (fs.Length < _lastPos)
                _lastPos = 0;
            fs.Seek(_lastPos, SeekOrigin.Begin);
            using var sr = new StreamReader(fs);
            var chunk = sr.ReadToEnd();
            _lastPos = fs.Position;

            foreach (var rx in AlertPatterns)
            {
                if (rx.IsMatch(chunk))
                {
                    Alert?.Invoke(this, $"NT log alert ({Path.GetFileName(e.FullPath)})");
                    break;
                }
            }
        }
        catch
        {
            /* ignore tail races */
        }
    }

    public void Dispose()
    {
        _watcher?.Dispose();
    }
}
