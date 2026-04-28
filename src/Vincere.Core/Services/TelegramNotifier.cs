using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;

namespace Vincere.Core.Services;

public sealed class TelegramNotifier
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly AppRuntimeConfig _config;
    private readonly ILogger<TelegramNotifier> _logger;

    public TelegramNotifier(AppRuntimeConfig config, ILogger<TelegramNotifier> logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task SendAsync(string text, CancellationToken cancellationToken = default)
    {
        var token = _config.TelegramBotToken;
        var chat = _config.TelegramChatId;
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(chat))
        {
            _logger.LogDebug("Telegram not configured; message skipped.");
            return;
        }

        var url = $"https://api.telegram.org/bot{token}/sendMessage";
        try
        {
            var payload = new
            {
                chat_id = chat,
                text,
                disable_web_page_preview = true
            };
            var res = await Http.PostAsJsonAsync(url, payload, cancellationToken).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                _logger.LogWarning("Telegram HTTP {Code}", (int)res.StatusCode);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Telegram send failed");
        }
    }
}
