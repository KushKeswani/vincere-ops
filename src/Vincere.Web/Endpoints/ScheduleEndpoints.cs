using Vincere.Core.Infrastructure;
using Vincere.Core.Services;
using Vincere.Web.Hosting;

namespace Vincere.Web.Endpoints;

public static class ScheduleEndpoints
{
    public static void MapScheduleEndpoints(this WebApplication app)
    {
        app.MapGet("/api/schedule", (AppRuntimeConfig config, TradingBotOrchestrator orchestrator) => Results.Json(new
        {
            ok = true,
            enabled = config.ReadyAlgosScheduleEnabled,
            time = config.ReadyAlgosTime.ToString("HH:mm"),
            timezone = "Eastern",
            enableStrategies = config.ReadyAlgosEnableStrategies,
            armed = orchestrator.IsArmed
        }));

        // Writes schedule config to the .env file and re-arms the scheduler without a restart.
        // Setting enableStrategies=true is itself guarded: it would let the scheduled run enable
        // live strategies, so it is only accepted when LiveGuard approves.
        app.MapPost("/api/schedule", (ScheduleUpdateRequest req, AppRuntimeConfig config,
            AppSettingsProvider settings, LiveGuard guard, VincereSchedulerHostedService scheduler) =>
        {
            if (req.EnableStrategies == true)
            {
                var decision = guard.Evaluate(req.Confirm);
                if (!decision.Allowed)
                    return Results.Json(new
                    {
                        ok = false,
                        blocked = true,
                        message = "Refused to enable scheduled live strategy enabling: " + decision.Reason
                    });
            }

            if (req.Time is not null && !TimeOnly.TryParse(req.Time, out _))
                return Results.Json(new { ok = false, message = "Time must be HH:mm (Eastern)." });

            var updates = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase);
            if (req.Enabled is not null)
                updates[AppRuntimeConfig.KeyReadyAlgosScheduleEnabled] = req.Enabled.Value ? "true" : "false";
            if (req.Time is not null)
                updates[AppRuntimeConfig.KeyReadyAlgosTime] = req.Time.Trim();
            if (req.EnableStrategies is not null)
                updates[AppRuntimeConfig.KeyReadyAlgosEnableStrategies] = req.EnableStrategies.Value ? "true" : "false";

            settings.UpdateAndSaveEnvFile(updates);
            settings.Reload();
            scheduler.Rearm();

            return Results.Json(new
            {
                ok = true,
                enabled = config.ReadyAlgosScheduleEnabled,
                time = config.ReadyAlgosTime.ToString("HH:mm"),
                timezone = "Eastern",
                enableStrategies = config.ReadyAlgosEnableStrategies
            });
        });

        app.MapPost("/api/scheduler/arm", (AppSettingsProvider settings, VincereSchedulerHostedService scheduler) =>
        {
            var updates = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase)
            {
                [AppRuntimeConfig.KeyReadyAlgosScheduleEnabled] = "true"
            };
            settings.UpdateAndSaveEnvFile(updates);
            settings.Reload();
            scheduler.Rearm();
            return Results.Json(new { ok = true, armed = true });
        });

        app.MapPost("/api/scheduler/disarm", (AppSettingsProvider settings, VincereSchedulerHostedService scheduler) =>
        {
            var updates = new Dictionary<string, string>(settings.Merged, StringComparer.OrdinalIgnoreCase)
            {
                [AppRuntimeConfig.KeyReadyAlgosScheduleEnabled] = "false"
            };
            settings.UpdateAndSaveEnvFile(updates);
            settings.Reload();
            scheduler.Rearm();
            return Results.Json(new { ok = true, armed = false });
        });
    }
}
