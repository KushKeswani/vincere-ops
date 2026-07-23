using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

var path = Path.Combine(AppContext.BaseDirectory, "vectors.json");
using var document = JsonDocument.Parse(File.ReadAllText(path, Encoding.UTF8));
var root = document.RootElement;
if (root.GetProperty("canonicalization").GetString() != "RFC8785")
{
    throw new InvalidOperationException("Unexpected canonicalization identifier.");
}

foreach (var vector in root.GetProperty("vectors").EnumerateArray())
{
    var name = vector.GetProperty("name").GetString() ?? "unnamed";
    var canonical = Canonicalize(vector.GetProperty("input"));
    var expectedCanonical = vector.GetProperty("canonical").GetString();
    var expectedHash = vector.GetProperty("sha256").GetString();
    var actualHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    if (canonical != expectedCanonical || actualHash != expectedHash)
    {
        throw new InvalidOperationException($"Contract vector failed: {name}");
    }
    Console.WriteLine($"PASS {name}");
}

static string Canonicalize(JsonElement element)
{
    return element.ValueKind switch
    {
        JsonValueKind.Object => "{" + string.Join(",", element.EnumerateObject()
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => SerializeString(property.Name) + ":" + Canonicalize(property.Value))) + "}",
        JsonValueKind.Array => "[" + string.Join(",", element.EnumerateArray().Select(Canonicalize)) + "]",
        JsonValueKind.String => SerializeString(element.GetString() ?? string.Empty),
        JsonValueKind.Number => FormatNumber(element.GetDouble()),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => throw new InvalidOperationException("Unsupported JSON value kind."),
    };
}

static string SerializeString(string value)
{
    return JsonSerializer.Serialize(value, new JsonSerializerOptions {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    });
}

static string FormatNumber(double value)
{
    if (!double.IsFinite(value))
    {
        throw new InvalidOperationException("RFC 8785 does not permit non-finite numbers.");
    }
    if (value == 0d) return "0";

    var roundTrip = value.ToString("R", CultureInfo.InvariantCulture).Replace("E", "e", StringComparison.Ordinal);
    var exponentSeparator = roundTrip.IndexOf('e');
    if (exponentSeparator < 0) return roundTrip;

    var mantissa = roundTrip[..exponentSeparator];
    var exponent = int.Parse(roundTrip[(exponentSeparator + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
    return mantissa + "e" + (exponent >= 0 ? "+" : string.Empty) + exponent.ToString(CultureInfo.InvariantCulture);
}

