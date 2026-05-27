using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Vincere.Core.Infrastructure;

namespace Vincere.Core.Services;

public sealed record LicenseVerificationResult(
    bool Ok,
    string Message,
    string? Status = null,
    string? MembershipId = null);

public sealed class LicenseVerificationService
{
    public const string ResetLicenseHelpUrl =
        "https://whop.com/joined/vincere-trading/tech-tutorials-please-watch-h4jL5pEVhsauxq/app/courses/cors_4CWAX5KDSF1rU/lessons/lesn_5KW4rCC5e2Ohn/";

    private static readonly HashSet<string> ValidStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "active",
        "trialing",
        "completed",
        "test-bypass"
    };

    private readonly AppRuntimeConfig _config;
    private readonly ILogger<LicenseVerificationService> _logger;
    private readonly HttpClient _http = new();

    public LicenseVerificationService(AppRuntimeConfig config, ILogger<LicenseVerificationService> logger)
    {
        _config = config;
        _logger = logger;
    }

    public async Task<LicenseVerificationResult> VerifyAsync(string? licenseKey, CancellationToken ct = default)
    {
        var key = licenseKey?.Trim();
        if (_config.LicenseTestMode && string.IsNullOrWhiteSpace(_config.LicenseApiUrl))
            return new LicenseVerificationResult(true,
                "TEST MODE: license verification bypassed because VINCERE_LICENSE_TEST_MODE=true and no license API URL is configured.",
                "test-bypass");

        if (string.IsNullOrWhiteSpace(key))
            return new LicenseVerificationResult(false, WithResetHelp("License key is required."));

        if (!string.IsNullOrWhiteSpace(_config.LicenseApiUrl))
            return await VerifyWithVercelBackendAsync(key, ct).ConfigureAwait(false);

        return new LicenseVerificationResult(false, "License verification endpoint is not configured.");
    }

    public bool HasLocalVerifiedLicense()
    {
        return !string.IsNullOrWhiteSpace(_config.LicenseKey)
               && _config.LicenseVerified
               && !string.IsNullOrWhiteSpace(_config.LicenseStatus)
               && ValidStatuses.Contains(_config.LicenseStatus)
               && (!_config.LicenseStatus.Equals("test-bypass", StringComparison.OrdinalIgnoreCase)
                   || _config.LicenseTestMode);
    }

    private async Task<LicenseVerificationResult> VerifyWithVercelBackendAsync(string key, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, _config.LicenseApiUrl);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Content = new StringContent(JsonSerializer.Serialize(new { licenseKey = key }), Encoding.UTF8, "application/json");

        try
        {
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var result = ParseBackendResult(body);

            if (result is not null)
                return result.Ok
                    ? result
                    : result with { Message = WithResetHelp(result.Message) };

            return new LicenseVerificationResult(false, $"License verification failed ({(int)res.StatusCode}).");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Backend license verification failed");
            return new LicenseVerificationResult(false, "Could not verify license with the Vincere license server.");
        }
    }

    private static LicenseVerificationResult? ParseBackendResult(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return null;

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
            return null;

        var ok = root.TryGetProperty("ok", out var okValue)
                 && okValue.ValueKind == JsonValueKind.True;
        var message = ReadString(root, "message") ?? (ok ? "License verified." : "License verification failed.");
        var status = ReadString(root, "status");
        var membershipId = ReadString(root, "membershipId") ?? ReadString(root, "membership_id");
        return new LicenseVerificationResult(ok, message, status, membershipId);
    }

    private static string? ReadString(JsonElement root, string name)
    {
        return root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static string WithResetHelp(string message)
    {
        return $"{message}\n\nIf the license key is invalid, reset it here:\n{ResetLicenseHelpUrl}";
    }
}
