using System.Diagnostics;
namespace Vincere.Core.Services;

public sealed class NinjaTraderProcessService
{
    public async Task<string> LaunchAsync(CancellationToken ct = default)
    {
        var script = FindOptionalNinjaTraderLoginScript();
        if (!string.IsNullOrWhiteSpace(script))
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            using var process = Process.Start(psi);
            if (process is not null)
            {
                var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
                var stderrTask = process.StandardError.ReadToEndAsync(ct);
                await process.WaitForExitAsync(ct).ConfigureAwait(false);
                var stdout = (await stdoutTask.ConfigureAwait(false)).Trim();
                var stderr = (await stderrTask.ConfigureAwait(false)).Trim();
                if (process.ExitCode == 0)
                    return string.IsNullOrWhiteSpace(stdout) ? "NinjaTrader launch requested." : stdout;
                return string.IsNullOrWhiteSpace(stderr) ? "NinjaTrader launch failed." : stderr;
            }
        }

        var exe = FindNinjaTraderExe();
        if (string.IsNullOrWhiteSpace(exe))
            return "NinjaTrader executable was not found.";

        if (Process.GetProcessesByName("NinjaTrader").Any())
            return "NinjaTrader is already running.";

        Process.Start(new ProcessStartInfo { FileName = exe, UseShellExecute = true });
        return "NinjaTrader launch requested.";
    }

    public async Task<string> ShutdownAsync(CancellationToken ct = default)
    {
        var processes = Process.GetProcessesByName("NinjaTrader");
        if (processes.Length == 0)
            return "NinjaTrader is not running.";

        foreach (var process in processes)
        {
            try
            {
                if (!process.CloseMainWindow())
                    process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Process may have exited between enumeration and shutdown.
            }
        }

        var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
        while (DateTimeOffset.UtcNow < deadline && Process.GetProcessesByName("NinjaTrader").Any())
        {
            await Task.Delay(500, ct).ConfigureAwait(false);
        }

        foreach (var process in Process.GetProcessesByName("NinjaTrader"))
        {
            try { process.Kill(entireProcessTree: true); }
            catch { }
        }

        return "NinjaTrader shutdown requested.";
    }

    public async Task<string> ResetAsync(CancellationToken ct = default)
    {
        var shutdown = await ShutdownAsync(ct).ConfigureAwait(false);
        await Task.Delay(TimeSpan.FromSeconds(5), ct).ConfigureAwait(false);
        var launch = await LaunchAsync(ct).ConfigureAwait(false);
        return $"{shutdown} {launch}";
    }

    private static string? FindOptionalNinjaTraderLoginScript()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "scripts", "Start-NinjaTraderWithOptionalLogin.ps1"),
            Path.Combine(AppContext.BaseDirectory, "Start-NinjaTraderWithOptionalLogin.ps1"),
            @"C:\Users\Administrator\Desktop\vincere-ops\scripts\Start-NinjaTraderWithOptionalLogin.ps1"
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    private static string? FindNinjaTraderExe()
    {
        var candidates = new[]
        {
            @"C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe",
            @"C:\Program Files (x86)\NinjaTrader 8\bin\NinjaTrader.exe"
        };

        return candidates.FirstOrDefault(File.Exists);
    }
}
