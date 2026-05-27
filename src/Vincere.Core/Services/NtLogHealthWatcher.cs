using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;

namespace Vincere.Core.Services;

/// <summary>
/// Watches NT log folder for disconnect / chart-freeze / market-data symptoms. Fires callback; no passcode logging.
/// </summary>
public sealed class NtLogHealthWatcher : IDisposable
{
    private static readonly (Regex Pattern, string Reason)[] AlertPatterns =
    {
        (new("disconnect(ed|ion)?", RegexOptions.IgnoreCase | RegexOptions.Compiled), "disconnect"),
        (new("connection.*(lost|closed|terminated|reset|dropped|broken)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "connection lost"),
        (new("(login|logon|connection).*failed", RegexOptions.IgnoreCase | RegexOptions.Compiled), "connection failed"),
        (new("(market data|data feed|price feed|historical data).*(lost|stalled|stopped|disconnected|terminated|unavailable|not connected)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "data feed issue"),
        (new("(freeze|frozen|stalled|stale|not responding|no data|no market data)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "chart/data freeze"),
        (new("(CQG|Rithmic|Tradovate|NinjaTrader Brokerage|Continuum).*(lost|disconnect|stalled|unavailable|not connected)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "broker feed issue"),
    };

    private readonly AppRuntimeConfig _config;
    private readonly ILogger<NtLogHealthWatcher> _logger;
    private FileSystemWatcher? _watcher;
    private readonly string _dir;
    private readonly object _gate = new();
    private readonly Dictionary<string, long> _positions = new(StringComparer.OrdinalIgnoreCase);
    private Timer? _pollTimer;
    private bool _started;

    public event EventHandler<NtHealthAlertEventArgs>? Alert;

    public NtLogHealthWatcher(AppRuntimeConfig config, ILogger<NtLogHealthWatcher> logger)
    {
        _config = config;
        _logger = logger;
        _dir = config.NinjaTraderLogDirectory;
    }

    public void Start()
    {
        if (_started)
            return;

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
            _pollTimer = new Timer(_ => PollLatestLogs(), null, TimeSpan.Zero,
                TimeSpan.FromSeconds(_config.NtHealthPollSeconds));
            _started = true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not start NT log watcher");
        }
    }

    private void OnChanged(object sender, FileSystemEventArgs e)
        => ScanFile(e.FullPath);

    private void PollLatestLogs()
    {
        try
        {
            if (!Directory.Exists(_dir))
                return;

            foreach (var file in Directory.EnumerateFiles(_dir, "*.txt")
                         .Select(path => new FileInfo(path))
                         .OrderByDescending(f => f.LastWriteTimeUtc)
                         .Take(3))
            {
                ScanFile(file.FullName);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "NT log poll skipped");
        }
    }

    private void ScanFile(string path)
    {
        try
        {
            if (!File.Exists(path))
                return;

            string chunk;
            long newPos;
            lock (_gate)
            {
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (!_positions.TryGetValue(path, out var lastPos) || fs.Length < lastPos)
                    lastPos = 0;
                fs.Seek(lastPos, SeekOrigin.Begin);
                using var sr = new StreamReader(fs);
                chunk = sr.ReadToEnd();
                newPos = fs.Position;
                _positions[path] = newPos;
            }

            if (string.IsNullOrWhiteSpace(chunk))
                return;

            var fileName = Path.GetFileName(path);
            foreach (var (rx, reason) in AlertPatterns)
            {
                if (!rx.IsMatch(chunk))
                    continue;

                var sample = FirstMatchingLine(chunk, rx);
                Alert?.Invoke(this, new NtHealthAlertEventArgs(reason, fileName, sample));
                break;
            }
        }
        catch
        {
            /* ignore tail races */
        }
    }

    private static string FirstMatchingLine(string chunk, Regex rx)
    {
        using var sr = new StringReader(chunk);
        string? line;
        while ((line = sr.ReadLine()) is not null)
        {
            if (!rx.IsMatch(line))
                continue;

            line = line.Trim();
            return line.Length <= 220 ? line : line[..220] + "...";
        }

        return "";
    }

    public void Stop()
    {
        _pollTimer?.Dispose();
        _pollTimer = null;
        _watcher?.Dispose();
        _watcher = null;
        _started = false;
    }

    public void Dispose()
    {
        Stop();
    }
}

public sealed class NtHealthAlertEventArgs : EventArgs
{
    public NtHealthAlertEventArgs(string reason, string logFileName, string sample)
    {
        Reason = reason;
        LogFileName = logFileName;
        Sample = sample;
    }

    public string Reason { get; }
    public string LogFileName { get; }
    public string Sample { get; }

    public override string ToString()
    {
        return string.IsNullOrWhiteSpace(Sample)
            ? $"NT health alert: {Reason} ({LogFileName})"
            : $"NT health alert: {Reason} ({LogFileName}) - {Sample}";
    }
}
