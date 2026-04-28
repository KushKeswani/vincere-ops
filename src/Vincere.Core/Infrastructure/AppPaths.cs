namespace Vincere.Core.Infrastructure;

public static class AppPaths
{
    public static string RootDataDirectory =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Vincere.Operator");

    public static string DatabasePath => Path.Combine(RootDataDirectory, "vincere.db");

    public static string EnvFilePath => Path.Combine(RootDataDirectory, ".env");

    public static string LogsDirectory => Path.Combine(RootDataDirectory, "logs");

    public static string DefaultNinjaTraderLogRoot()
    {
        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        return Path.Combine(docs, "NinjaTrader 8", "log");
    }
}
