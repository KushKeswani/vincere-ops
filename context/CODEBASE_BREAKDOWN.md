# Codebase Breakdown

Practical walkthrough of the repository for engineers and AI agents.

## 1) Top-Level

- `Vincere.slnx` - solution entrypoint for .NET projects
- `README.md` - product + setup overview
- `SETUP_WINDOWS.md` - Windows VPS runbook
- `.env.example` - runtime config reference
- `APPLICATION_OUTLINE.md` - product/business framing
- `context/` - living docs + AI handoff prompts

## 2) Projects

## `src/Vincere.Operator` (WPF UI)

Main files:

- `App.xaml.cs`
  - app startup
  - ensures DB exists through core extension
- `MainWindow.xaml` + `MainWindow.xaml.cs`
  - dashboard controls
  - PING test action
  - stack editor grid
  - period/apply filters
  - Excel import mapping UI
  - template refresh action
- `OnboardingWindow.*`
  - first-run account + connection + telegram capture
- `DeveloperEnvWindow.*`
  - passcode-protected env editing
- `PasscodeWindow.*`
  - lock gate for developer actions

UI responsibilities:

- display runtime state
- collect operator inputs
- call core services
- show actionable diagnostics

## `src/Vincere.Core` (Domain + Infra + Data + Services)

### Data

- `Data/Entities.cs`
  - `AppStateEntity` scheduler checkpoints
  - `TradingAccountEntity`
  - `StackStrategyRowEntity` (includes period/apply flags)
  - `PerformanceDailyEntity`
  - `ExcelAccountMappingEntity`
- `Data/VincereDbContext.cs`
  - EF model + DB sets

### Infrastructure

- `Infrastructure/AppPaths.cs`
  - local app paths
- `Infrastructure/DotEnvParser.cs`
  - parse/write `.env`
- `Infrastructure/AppSettingsProvider.cs`
  - merge `.env` + Windows env vars (env wins)
- `Infrastructure/AppRuntimeConfig.cs`
  - typed access to runtime keys (IPC, schedule, templates, etc.)
- `Infrastructure/VincereSchemaPatcher.cs`
  - add columns for schema evolution without formal migrations
- `Infrastructure/NinjaTraderInstallationPaths.cs`
  - discover NT paths under Documents/OneDrive style folders

### Services

- `Services/NinjaTraderIpcBridge.cs`
  - named-pipe client
  - retries/timeout behavior
- `Services/TradingBotOrchestrator.cs`
  - timer-driven daily orchestration
- `Services/StackApplyService.cs`
  - builds apply payload from rows + filters
- `Services/ExcelImportService.cs`
  - parse spreadsheets, normalize period values, upsert stack rows
- `Services/NinjaTraderTemplateDiscoveryService.cs`
  - scans NT template XML names for dropdown
- `Services/NtLogHealthWatcher.cs`
  - monitor NT logs
- `Services/TelegramNotifier.cs`
  - optional notifications
- `Services/DeveloperAccessGate.cs`
  - lockout/passcode gate
- `Services/ReportingService.cs`
  - report/digest support

### Composition

- `ServiceCollectionExtensions.cs`
  - DI graph
  - DB ensure/create
  - schema patch invocation

## `src/Vincere.Ipc.Contract` (Shared IPC Contract)

- `IpcEnvelope.cs`
  - request/response DTOs + command names
  - central contract boundary between app and NT Add-On

## 3) NinjaTrader Add-On (`nt8-addon/`)

- `VincereOperatorIpcAddOn.cs`
  - AddOnBase implementation
  - named-pipe server and command dispatch
  - startup and runtime diagnostics
  - currently includes stubs/partial behavior for some commands
- `README.md`
  - add-on install/compile usage

Important:

- this code is compiled by NinjaTrader (not the main `dotnet build`)
- compatibility is .NET Framework/NinjaScript environment

## 4) Script Layer (`scripts/`)

Purpose: make VPS operator workflows one-command and repeatable.

- `Setup-VincereOps.ps1`
  - build/publish + runtime env merge
- `Pull-VincereOps.ps1`
  - git pull + optional setup run
- `Install-VincereAddon.ps1` + `.cmd`
  - discover NT custom folders and copy add-on source
- `Test-VincereIpcSmoke.ps1` + `.cmd`
  - direct pipe smoke test (PING)
- `Sync-VincereOps.ps1` + `.cmd`
  - pull + pipe alignment + install + publish + env sync

## 5) Runtime Data Model (operator perspective)

Core local artifacts in `%LocalAppData%\Vincere.Operator`:

- `.env` (config)
- `vincere.db` (accounts/stacks/perf/app state)
- logs directory

Main flow:

1. User edits/imports stack rows
2. Rows saved to SQLite
3. Apply action builds payload (period/apply filtered)
4. IPC bridge sends to NT add-on
5. Add-on handles command and returns response

## 6) Where to look for common tasks

- "Why doesn't PING work?"
  - `NinjaTraderIpcBridge.cs`
  - `VincereOperatorIpcAddOn.cs`
  - `scripts/Test-VincereIpcSmoke.ps1`
- "How are templates populated?"
  - `NinjaTraderTemplateDiscoveryService.cs`
  - `MainWindow.xaml.cs` (`RefreshNtTemplateChoicesAsync`)
- "How are stacks imported?"
  - `ExcelImportService.cs`
  - `MainWindow.xaml.cs` (`PickExcel_Click`, `ImportExcel_Click`)
- "How does scheduled refresh happen?"
  - `TradingBotOrchestrator.cs`

## 7) Practical onboarding checklist for another AI

1. Read `context/RUNNING_CONTEXT.md`
2. Read this file (`context/CODEBASE_BREAKDOWN.md`)
3. Read `README.md` + `SETUP_WINDOWS.md`
4. Read IPC boundary files:
  - `src/Vincere.Ipc.Contract/IpcEnvelope.cs`
  - `src/Vincere.Core/Services/NinjaTraderIpcBridge.cs`
  - `nt8-addon/VincereOperatorIpcAddOn.cs`
5. Run/build locally where possible
6. Make smallest safe change first and validate with smoke script