using Microsoft.EntityFrameworkCore;

namespace Vincere.Core.Data;

public sealed class VincereDbContext : DbContext
{
    public VincereDbContext(DbContextOptions<VincereDbContext> options) : base(options) { }

    public DbSet<AppStateEntity> AppState => Set<AppStateEntity>();
    public DbSet<TradingAccountEntity> Accounts => Set<TradingAccountEntity>();
    public DbSet<StackStrategyRowEntity> StackStrategies => Set<StackStrategyRowEntity>();
    public DbSet<PerformanceDailyEntity> PerformanceDaily => Set<PerformanceDailyEntity>();
    public DbSet<ExcelAccountMappingEntity> ExcelMappings => Set<ExcelAccountMappingEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppStateEntity>().HasKey(x => x.Id);
        modelBuilder.Entity<TradingAccountEntity>().HasKey(x => x.Id);
        modelBuilder.Entity<StackStrategyRowEntity>().HasKey(x => x.Id);
        modelBuilder.Entity<PerformanceDailyEntity>().HasKey(x => x.Id);
        modelBuilder.Entity<ExcelAccountMappingEntity>().HasKey(x => x.Id);
    }
}
