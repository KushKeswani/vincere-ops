# Vincere Ops - Running Context

Last updated: 2026-04-28

This file is a living handoff log for humans and other AI agents. Update it after meaningful repo/debug changes.

Related context docs:
- `context/PROJECT_BRIEF.md` (big-picture goals, what we tried, target state)
- `context/CODEBASE_BREAKDOWN.md` (technical code map and file responsibilities)

## 1) What this repo is

`Vincere Ops` is a Windows WPF operator app for NinjaTrader 8.

Main responsibilities:
- Manage account stacks (strategy rows, templates, labels, apply flags, period selection)
- Import stack rows from Excel
- Run timed orchestration tasks (connection refresh, enable-all, EOD digest hooks)
- Notify via Telegram
- Talk to a NinjaTrader in-process Add-On via named-pipe IPC

## 2) Repo map

- `src/Vincere.Operator`: WPF UI
- `src/Vincere.Core`: services, EF Core SQLite data layer, env/runtime config
- `src/Vincere.Ipc.Contract`: shared IPC DTOs/commands
- `nt8-addon/VincereOperatorIpcAddOn.cs`: NinjaTrader Add-On pipe server
- `scripts/`: setup/install/update/debug scripts for VPS workflows
- `knowledge/`: non-secret operator notes

## 3) Current runtime architecture

Operator app:
- Published EXE path: `%LOCALAPPDATA%\Programs\VincereOps\Vincere.Operator.exe`
- Runtime data path: `%LocalAppData%\Vincere.Operator\`
  - `.env`
  - `vincere.db`

NinjaTrader side:
- Add-On C# copied into:
  - `<Documents>\NinjaTrader 8\bin\Custom\AddOns\VincereOperator\VincereOperatorIpcAddOn.cs`
- Must compile in NinjaScript Editor and restart NT.

IPC:
- App client: `src/Vincere.Core/Services/NinjaTraderIpcBridge.cs`
- Add-On server: `nt8-addon/VincereOperatorIpcAddOn.cs`

## 4) Key changes made in this chat

### Setup/ops scripts
- Added/updated:
  - `scripts/Setup-VincereOps.ps1`
  - `scripts/Pull-VincereOps.ps1`
  - `scripts/Install-VincereAddon.ps1`
  - `scripts/Install-VincereAddon.cmd`
  - `scripts/Test-VincereIpcSmoke.ps1`
  - `scripts/Test-VincereIpcSmoke.cmd`
  - `scripts/Sync-VincereOps.ps1`
  - `scripts/Sync-VincereOps.cmd`

### Stack UX/data model
- Added stack row controls:
  - `IncludeInApply` flag
  - `TradingPeriod` (`Period1`, `Period2`, or empty)
- Added apply filter selection in UI (all checked / Period1 / Period2)
- Added template dropdown population from:
  1) `.env` explicit list
  2) discovered NinjaTrader template XML files
  3) templates already stored in DB
- Added DB patching to add new columns without migrations:
  - `src/Vincere.Core/Infrastructure/VincereSchemaPatcher.cs`

### Template discovery
- Added:
  - `src/Vincere.Core/Infrastructure/NinjaTraderInstallationPaths.cs`
  - `src/Vincere.Core/Services/NinjaTraderTemplateDiscoveryService.cs`
- Scans `...\NinjaTrader 8\templates\**\*.xml` and surfaces names into template dropdown.

### IPC reliability/debugging
- Increased and parameterized app-side timeouts/retries:
  - `VINCERE_IPC_CONNECT_MS`
  - `VINCERE_IPC_RETRY_ATTEMPTS`
  - `VINCERE_IPC_RETRY_DELAY_MS`
- Added better Ping failure text in UI (never blank).
- Add-On changes:
  - moved to `namespace NinjaTrader.NinjaScript.AddOns` so NT instantiates it
  - dual logging (`Print` + `Log`)
  - extra startup traces (`SetDefaults`, `Configure`, loop, etc.)
  - pipe loop disposal and contention hardening
  - mutex + max server instances to reduce duplicate-listener contention

## 5) Known active problem (from latest session)

Even with Add-On startup visible, smoke tests still showed connection timeouts in some runs.

Observed behaviors:
- NT messages showed add-on startup lines.
- Some runs showed repeated `All pipe instances are busy`.
- Smoke test in CMD timed out connecting.

Likely contributors:
- stale duplicate add-on class copies under NT custom source tree
- stale NT compile artifacts (`bin/obj`)
- pipe-name mismatch (`VincereOperator` vs `VincereOperator2`)
- possible session/user mismatch between NT process and caller shell

## 6) Current recommended debug sequence

1. Ensure single source copy:
   - search for multiple `VincereOperatorIpcAddOn.cs` copies in `...\NinjaTrader 8\bin\Custom\`
   - ensure only one class definition `class VincereOperatorIpcAddOn`
2. Remove `...\bin\Custom\bin` and `...\bin\Custom\obj`.
3. Run one-command sync:
   - `.\scripts\Sync-VincereOps.cmd`
4. Compile in NinjaScript Editor.
5. Restart NinjaTrader.
6. Run smoke test:
   - `.\scripts\Test-VincereIpcSmoke.cmd <pipe-name>`
7. Confirm same Windows identity:
   - `whoami` in shell and NT session context

## 7) Important config keys

In `%LocalAppData%\Vincere.Operator\.env`:
- `VINCERE_IPC_PIPE_NAME`
- `VINCERE_IPC_CONNECT_MS`
- `VINCERE_IPC_RETRY_ATTEMPTS`
- `VINCERE_IPC_RETRY_DELAY_MS`
- `DRY_RUN=false` for real IPC
- `PROP_CONNECTION_NAME=<exact NT connection display name>`
- `NT_TEMPLATE_CHOICES`
- `NT_TEMPLATE_DIRS_EXTRA`
- `NT_TEMPLATE_SCAN_EXTRA_ONLY`

## 8) Safety notes

- `.env` and local DB are user-local runtime data; do not commit secrets.
- `Sync-VincereOps` patches add-on source constant and updates runtime `.env` keys.
- If user reports missing data, check:
  - `%LocalAppData%\Vincere.Operator\vincere.db` exists
  - `DATA_DIR` did not change unexpectedly
  - active Windows user/profile did not change

## 9) Next high-value improvements

- Add explicit backup/restore step in sync script for `vincere.db` before changes.
- Add duplicate-class detector script specifically for NT custom source.
- Add optional runtime "IPC diagnostics panel" in app (show pipe name, retries, raw ping latency, last exception).
- Consider making Add-On pipe name configurable from NT script property or external config to avoid source patching.

## 10) Latest commits from this chat (highlights)

- `6cb170f` one-click sync scripts
- `aba75ab` command-line IPC smoke tests
- `3fbfb9e` ping diagnostics improvements
- `592a5e7` add-on hardening with mutex/max instances
- `c4a1de3` restart/duplicate listener contention fixes
- `3794432` add-on logs to control-center messages
- `291c281` add-on namespace/autoload fix
- `7991550` template discovery from NT template folders
- `849fea5` IPC retry/timeout resilience
- `ec9d320` stack period/apply/template UX improvements

