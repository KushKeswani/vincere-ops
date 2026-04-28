using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Vincere.Core.Data;

public sealed class AppStateEntity
{
    [Key] public int Id { get; set; } = 1;
    public bool OnboardingCompleted { get; set; }
    public string? ClientInternalId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Eastern calendar yyyy-MM-dd — connection refresh already fired.</summary>
    public string? LastConnectionRefreshDayIso { get; set; }

    /// <summary>Eastern calendar yyyy-MM-dd — enable-all fired.</summary>
    public string? LastEnableAllDayIso { get; set; }

    /// <summary>Eastern calendar yyyy-MM-dd — EOD ingest/report fired.</summary>
    public string? LastEodDayIso { get; set; }

    /// <summary>Eastern Friday yyyy-MM-dd — weekly digest fired.</summary>
    public string? LastWeeklyReportFridayIso { get; set; }

    /// <summary>yyyy-MM — monthly digest fired.</summary>
    public string? LastMonthlyReportYm { get; set; }
}

public sealed class TradingAccountEntity
{
    public Guid Id { get; set; }
    public string RawAccountNumber { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class StackStrategyRowEntity
{
    public Guid Id { get; set; }
    public Guid AccountId { get; set; }

    /// <summary>Empty, <c>Period1</c>, or <c>Period2</c> — used with apply filter and Excel "Period" column.</summary>
    public string TradingPeriod { get; set; } = "";

    /// <summary>If false, row is skipped when applying stack to NinjaTrader.</summary>
    public bool IncludeInApply { get; set; } = true;

    public string StrategyTypeName { get; set; } = "";
    public string TemplateName { get; set; } = "";
    public string InstanceLabel { get; set; } = "";
    public string? AccountAttachment { get; set; }
    public int SortOrder { get; set; }

    [ForeignKey(nameof(AccountId))]
    public TradingAccountEntity? Account { get; set; }
}

public sealed class PerformanceDailyEntity
{
    public Guid Id { get; set; }
    public Guid AccountId { get; set; }
    public DateOnly DateEastern { get; set; }
    public decimal Pnl { get; set; }
    public int TradeCount { get; set; }
    public string Source { get; set; } = "import";
    public DateTimeOffset ImportedAt { get; set; } = DateTimeOffset.UtcNow;

    [ForeignKey(nameof(AccountId))]
    public TradingAccountEntity? Account { get; set; }
}

public sealed class ExcelAccountMappingEntity
{
    public Guid Id { get; set; }
    public string RawAccountFromFile { get; set; } = "";
    public Guid MappedAccountId { get; set; }
    public string? AlgoStackId { get; set; }
}
