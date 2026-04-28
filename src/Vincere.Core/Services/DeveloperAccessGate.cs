namespace Vincere.Core.Services;

/// <summary>
/// Rate-limit developer panel attempts (passcode never logged).
/// </summary>
public sealed class DeveloperAccessGate
{
    private readonly object _lock = new();
    private int _failCount;
    private DateTimeOffset _lockedUntilUtc;

    public bool TryEnter(string candidatePasscode, string expectedPasscode)
    {
        lock (_lock)
        {
            if (DateTimeOffset.UtcNow < _lockedUntilUtc)
                return false;

            if (string.Equals(candidatePasscode.Trim(), expectedPasscode.Trim(), StringComparison.Ordinal))
            {
                _failCount = 0;
                return true;
            }

            _failCount++;
            if (_failCount >= 5)
            {
                _lockedUntilUtc = DateTimeOffset.UtcNow.AddMinutes(5);
                _failCount = 0;
            }

            return false;
        }
    }

    public bool IsLockedOut(DateTimeOffset utcNow)
    {
        lock (_lock)
        {
            return utcNow < _lockedUntilUtc;
        }
    }
}
