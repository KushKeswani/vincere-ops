using Vincere.Core;
using Vincere.Web.Endpoints;
using Vincere.Web.Hosting;

var builder = WebApplication.CreateBuilder(args);

// Loopback-only: the named pipe to NinjaTrader is local, and web auth is deferred,
// so the host must never be exposed off-box. Override with ASPNETCORE_URLS only on a
// trusted single-operator machine.
if (builder.Configuration["urls"] is null &&
    Environment.GetEnvironmentVariable("ASPNETCORE_URLS") is null)
{
    builder.WebHost.UseUrls("http://127.0.0.1:5178");
}

builder.Services.AddVincereCore();

// The scheduler is a singleton so the /api/schedule endpoint can re-arm it after config edits,
// and also registered as the hosted service that arms/disarms it with the host lifecycle.
builder.Services.AddSingleton<VincereSchedulerHostedService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<VincereSchedulerHostedService>());
builder.Services.AddSingleton<LiveGuard>();

var app = builder.Build();

await app.Services.EnsureVincereDatabaseAsync();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapStatusEndpoints();
app.MapControlEndpoints();
app.MapScheduleEndpoints();
app.MapBlueprintEndpoints();

app.MapFallbackToFile("index.html");

app.Run();
