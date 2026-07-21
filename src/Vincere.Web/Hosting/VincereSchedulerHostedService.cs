using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;
using Vincere.Core.Services;

namespace Vincere.Web.Hosting;

/// <summary>
/// Arms the existing <see cref="TradingBotOrchestrator"/> Timer scheduler when the web host
/// starts (if the ready schedule is enabled) and disarms it on shutdown. No new scheduling
/// logic — it reuses the orchestrator's tick/window/LastReadyAlgosDayIso idempotency verbatim.
/// The schedule endpoint calls <see cref="Rearm"/> so config edits take effect without a restart.
/// </summary>
public sealed class VincereSchedulerHostedService : IHostedService
{
    private readonly TradingBotOrchestrator _orchestrator;
    private readonly AppRuntimeConfig _config;
    private readonly ILogger<VincereSchedulerHostedService> _logger;

    public VincereSchedulerHostedService(
        TradingBotOrchestrator orchestrator,
        AppRuntimeConfig config,
        ILogger<VincereSchedulerHostedService> logger)
    {
        _orchestrator = orchestrator;
        _config = config;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        Rearm();
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _orchestrator.Stop();
        return Task.CompletedTask;
    }

    /// <summary>Re-evaluate the schedule flag and arm or disarm the orchestrator accordingly.</summary>
    public void Rearm()
    {
        if (_config.ReadyAlgosScheduleEnabled)
        {
            _orchestrator.Start();
            _logger.LogInformation("Scheduler armed (ready time {Time} Eastern, enable-strategies={Enable}).",
                _config.ReadyAlgosTime, _config.ReadyAlgosEnableStrategies);
        }
        else
        {
            _orchestrator.Stop();
            _logger.LogInformation("Scheduler disarmed (READY_ALGOS_SCHEDULE_ENABLED is false).");
        }
    }
}
