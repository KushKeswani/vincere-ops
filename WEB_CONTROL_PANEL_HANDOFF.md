# Vincere Web Control Panel — Handoff (2026-07-21)

Handoff for the next agent (Codex) picking up the browser-based NinjaTrader control panel.
Read `AGENT_HANDOFF.md` first (repo handoff policy + the new "Web Control Panel" section), then this file.

Repo: `KushKeswani/vincere-ops` · Branch: `cursor/diff-tab-create-branch-commit`
Working dir (Mac): `/Users/kushkeswani/Projects/Vincere/Automation ` (note trailing space)
VPS: `C:\Users\Administrator\Documents\Projects\Vincere\Automation`

---

## TL;DR — current state

- New project **`src/Vincere.Web/`** (ASP.NET Core minimal API, `net10.0`) added to `Vincere.slnx`.
- It serves a browser control panel and **reuses the existing `Vincere.Core` services** — **no trading
  logic was reimplemented**. It replaces the dead `ui-prototype` mockup and the Python `server.py`.
- **Builds clean** (`0 Error(s)`) and was **verified end-to-end in `DRY_RUN=true`** (curl + real browser).
- **Nothing is committed** — all work is uncommitted in the worktree. Do not commit without Kush asking.
- **No live trading path was enabled.** Guarded actions are blocked by `LiveGuard` and ship off.

---

## The gap this closed

Before: two disconnected pieces.
1. `ui-prototype/` — a static mockup. Only Blueprint Import was wired; every other button had no `id` and
   did nothing. `server.py` was a static file server with one endpoint (`POST /api/blueprint/preview`).
2. `nt8-addon/VincereOperatorIpcAddOn.cs` — a real NinjaTrader named-pipe JSON server.

Meanwhile **all the real control logic already existed as safety-gated C# in `Vincere.Core`**, driven by the
WPF app (`Vincere.Operator`): `TradingBotOrchestrator` (scheduler + `RunGetAlgosReadyNowAsync`),
`NinjaTraderIpcBridge` (pipe client, honors `DRY_RUN`), `StackApplyService`, `NinjaTraderProcessService`,
`ExcelImportService`, `ReportingService`. DI is centralized in `AddVincereCore()`.

The gap was a **web backend** to bridge the browser UI to that C# logic. That is what `Vincere.Web` is.

---

## Decisions locked with Kush (from planning)

The original brief was "wire 3 safe IPC buttons," but Kush's MVP notes described a full client/CSM web
control panel. After exploration + a plan (`~/.claude/plans/radiant-humming-dijkstra.md`), Kush chose:

1. **Backend** = thin .NET host wrapping `Vincere.Core` (my call) — reuses proven, safety-gated logic
   instead of re-implementing trading logic in Python.
2. **Auth = deferred.** Single-operator, loopback-only, no login this iteration. (Multi-user CSM/client
   auth + tenant-scoped data model is greenfield and out of scope for now.)
3. **First priority = the schedule + enable path** — but subject to the hard safety boundary below.

---

## Architecture

- **Runs on the NinjaTrader machine** (the IPC is a local named pipe). Binds to `http://127.0.0.1:5178`
  loopback only. Web auth deferred, so it must never be exposed off-box.
- **Run instead of the WPF app, not alongside it.** Both arm the same `TradingBotOrchestrator` timer and
  share the same SQLite DB — running both risks duplicate scheduled automation + DB write contention.
- `Program.cs` mirrors WPF `App.xaml.cs` startup: `AddVincereCore()` → `EnsureVincereDatabaseAsync()` →
  serve `wwwroot` → map endpoints → `Run()`. All services come from `AddVincereCore()`; the only new
  registrations are `LiveGuard` and `VincereSchedulerHostedService`.

### Files created (`src/Vincere.Web/`)
- `Vincere.Web.csproj` — `Microsoft.NET.Sdk.Web`, `net10.0`, ProjectReference → `Vincere.Core`.
- `Program.cs` — host bootstrap, loopback binding, static files, endpoint mapping.
- `Hosting/LiveGuard.cs` — the live-firing safety gate (see below).
- `Hosting/VincereSchedulerHostedService.cs` — arms/disarms the existing orchestrator timer with the host
  lifecycle; `Rearm()` is called by the schedule endpoint so config edits take effect without a restart.
- `Endpoints/StatusEndpoints.cs` — status, ping, connections, accounts.
- `Endpoints/ControlEndpoints.cs` — connect/disconnect/refresh, disable-all, and guarded actions.
- `Endpoints/ScheduleEndpoints.cs` — schedule get/set, scheduler arm/disarm.
- `Endpoints/BlueprintEndpoints.cs` — blueprint preview + import (replaces `server.py`).
- `Endpoints/WebContracts.cs` — request DTOs + `MaskAccount` + IPC-response projection helpers.
- `wwwroot/` — adapted copy of `ui-prototype` (`index.html`, `app.js`, `styles.css`), buttons wired.
- `README.md` — run + endpoints + limitations.

### Files changed (outside Vincere.Web)
- `Vincere.slnx` — added the Vincere.Web project.
- `.env.example` — added `VINCERE_WEB_ALLOW_LIVE=false` (web live-firing allowlist).
- `nt8-addon/VincereOperatorIpcAddOn.cs` — **pipe-name fix**: constant `VincereOperator2` → `VincereOperator`.
- `nt8-addon/README.md` — documents the pipe-name fix + recompile requirement.
- `AGENT_HANDOFF.md` — new "Web Control Panel" section.

---

## Endpoints

**Safe** (read-only, or already dry-run-guarded at the bridge — fine to serve live):

| Route | Reused Core code |
|---|---|
| `GET /api/status` | `AppRuntimeConfig`, `orchestrator.IsArmed`, AppState markers |
| `GET /api/ping` | `bridge.SendAsync(Ping)` |
| `GET /api/connections` | `bridge.SendAsync(ListConnections)` |
| `GET /api/accounts` | DbContext → Accounts (DisplayName + **masked** account #) |
| `POST /api/connections/{name}/{connect\|disconnect\|refresh}` | `bridge.SendAsync(...)` |
| `POST /api/strategies/disable-all` | `bridge.SendAsync(DisableAllStrategies)` (disable = safe direction) |
| `GET /api/schedule` | `AppRuntimeConfig.ReadyAlgos*` |
| `POST /api/schedule` | `AppSettingsProvider.UpdateAndSaveEnvFile` + `scheduler.Rearm()` |
| `POST /api/scheduler/{arm\|disarm}` | writes `READY_ALGOS_SCHEDULE_ENABLED` + re-arms |
| `POST /api/blueprint/preview` | `ExcelImportService.ParseAsync` |
| `POST /api/blueprint/import` | `ExcelImportService.UpsertStacksFromImportAsync` |

**Guarded** (plumbing built; `LiveGuard` blocks live firing by default):

| Route | Reused Core code |
|---|---|
| `POST /api/strategies/enable-all` | `bridge.SendAsync(EnableAllStrategies)` |
| `POST /api/stack/apply` | `StackApplyService.ExecuteAsync(accountId, dryRun:!live, filter, ct)` |
| `POST /api/flatten/all` | `bridge.SendAsync(FlattenAll)` |
| `POST /api/flatten/account/{id}` | `bridge.SendAsync(FlattenAccount)` |
| `POST /api/ready/run` | `orchestrator.RunGetAlgosReadyNowAsync` |

Note: enable/disable/flatten have **no public orchestrator method** (only `Start/Stop/IsArmed/
RunGetAlgosReadyNowAsync` are public), so they call `INinjaTraderBridge.SendAsync` directly with
`IpcCommands.*` constants — same contract as the WPF app.

---

## Safety model — `LiveGuard` (do not weaken without Kush's approval)

A guarded action fires live **only when all three** hold:
1. `DRY_RUN=false`, **and**
2. `VINCERE_WEB_ALLOW_LIVE=true` (server-side allowlist, default false), **and**
3. request body contains `"confirm":"LIVE"`.

Behavior when not all three hold:
- In `DRY_RUN=true`: the action runs **simulated** (bridge returns simulated success; `-WhatIf` for the
  stack-apply PowerShell path) and the response is flagged `blocked:true` with a reason.
- In `DRY_RUN=false` but not approved: the action is **refused outright** — it never reaches the pipe
  (verified: returns in ~16 ms instead of the ~8 s the bridge would take to fail on a missing pipe).

`POST /api/schedule` with `enableStrategies:true` is likewise refused unless `LiveGuard` passes, so the
scheduled path can't silently enable live strategies.

This is the human-approval substitute while web auth is deferred. **`READY_ALGOS_ENABLE_STRATEGIES` and
`VINCERE_WEB_ALLOW_LIVE` both default false and must stay that way** until Phase 4 (below) is cleared.

---

## How to run + verify (all of this passed on 2026-07-21, Mac, no NinjaTrader)

```bash
cd "/Users/kushkeswani/Projects/Vincere/Automation "
dotnet build src/Vincere.Web/Vincere.Web.csproj -c Debug          # 0 errors (1 pre-existing SQLite CVE warning from Core)
DRY_RUN=true ASPNETCORE_URLS=http://127.0.0.1:5178 \
  dotnet run --project src/Vincere.Web/Vincere.Web.csproj
# open http://127.0.0.1:5178/
```

Verified in dry-run:
- `GET /api/status` → `dryRun:true`, schedule + markers.
- `GET /api/ping`, connect, disable-all → `DRY_RUN simulated success`.
- `POST /api/schedule {enabled:true,time:"09:30",enableStrategies:false}` → saved + `armed:true`.
- `POST /api/schedule {...enableStrategies:true}` → **blocked/refused**.
- `enable-all` / `flatten/all` / `ready/run` (no confirm) → `blocked:true`, simulated.
- With `DRY_RUN=false` and no allowlist: `enable-all` → refused in ~16 ms, nothing sent.
- `POST /api/blueprint/preview` with `Vincere_Blueprint_2026-04-13.xlsx` → parsed rows returned.
- Browser: Test IPC / Enable Algos / Run Get Algos Ready buttons update the UI with the correct
  OK / simulated / blocked messages.

---

## Known limitations
- **Blueprint = .xlsx only** (ClosedXML). `server.py` accepted CSV; the C# path does not yet. Export xlsx.
- **Timezone:** schedule is **Eastern** (`READY_ALGOS_TIME`). Kush's notes say "8:30 CT" = `09:30` Eastern.
  UI labels the field "Eastern"; no auto CT↔ET conversion.
- The original `ui-prototype/` folder + `server.py` are left in place (not deleted); `Vincere.Web/wwwroot`
  is the live copy now.

---

## Blocked — Phase 4 (needs Kush's explicit approval + supervised test)

Do **not** enable live firing of any guarded action (or `READY_ALGOS_ENABLE_STRATEGIES=true`, or
`VINCERE_WEB_ALLOW_LIVE=true`) until ALL of:
1. NinjaTrader **instrument-selector Add-All failure is fixed + retested** (see AGENT_HANDOFF.md "Blocked").
2. **Pipe-name fix is applied live**: recompile `VincereOperatorIpcAddOn.cs` inside NinjaTrader (constant is
   now `VincereOperator`). Until recompiled, set `VINCERE_IPC_PIPE_NAME=VincereOperator2` in `.env`.
3. A human at the RDP desktop supervises a live test: confirm `OrdersGrid=0`/`PositionsGrid=0` before and
   after, run ping → connections → one guarded action with `confirm=LIVE` + allowlist, verify NT state,
   confirm all strategy rows disabled on completion.

---

## Suggested next steps (deferred MVP pieces, not yet built)
- **EOD snapshot** view: account # + daily **and lifetime** P&L + current algo stack, manually triggerable.
  Lifetime P&L has no entity today; `GET_ACCOUNT_STATE` is an unimplemented add-on stub;
  `ReportingService.ImportPerformanceStubAsync` is a stub — needs real NT P&L plumbing. Largest net-new work.
- **Auth layer** (login + CSM/client roles + tenant-scoped data model) — greenfield.
- **Blueprint import UI**: the `/api/blueprint/import` endpoint exists (file + raw→accountId mapping) but the
  wwwroot mapping UI still only stages rows client-side; wire it to the endpoint.
- **CSV blueprint support** in the C# parser (parity with old server.py).
- **NT launch/quit** web controls (`NinjaTraderProcessService` exists; low priority vs schedule/enable).

## Hard rules for the next agent
- Read-only / plan-first for anything that could fire live; get Kush's explicit separate approval before
  wiring `ENABLE_ALL_STRATEGIES` / `APPLY_STACK` / `FLATTEN_*` to fire live.
- `git status --short --branch` before editing; don't overwrite a dirty worktree; don't revert prior work.
- Don't print secrets/tokens or full trading account IDs (mask to last 4).
- Update this file + `AGENT_HANDOFF.md` when you change architecture / runtime behavior / env vars.
