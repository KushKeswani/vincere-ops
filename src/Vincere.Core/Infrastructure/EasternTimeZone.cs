namespace Vincere.Core.Infrastructure;

public static class EasternTime
{
    public static TimeZoneInfo GetEastern()
    {
        foreach (var id in new[] { "America/New_York", "Eastern Standard Time" })
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException) { }
        }
        return TimeZoneInfo.Utc;
    }

    public static DateTimeOffset NowEastern => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, GetEastern());

    public static DateTimeOffset UtcToEastern(DateTimeOffset utc) =>
        TimeZoneInfo.ConvertTime(utc, GetEastern());
}
