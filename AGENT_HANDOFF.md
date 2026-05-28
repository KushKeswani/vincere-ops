# Vincere Ninja Manager Agent Handoff

Date: 2026-05-28
Repo: vincere-ops
VPS workspace: `C:\Users\Administrator\Desktop\vincere-ops`
Baseline verified commit: `1885362` or newer

## Agent Handoff Policy

Every agent must treat this file as the persistent project memory.

At the start of every session:

1. Read `AGENT_HANDOFF.md` before editing code.
2. Read only the linked docs and files relevant to the current task.
3. Check the current repo state with `git status --short`.
4. Do not revert user, worker, or prior-agent changes unless explicitly asked.
5. Prefer focused changes over broad refactors.

During work, update documentation whenever the work changes any of the following:

- Architecture.
- Runtime behavior.
- Startup, deployment, or operational commands.
- Known limitations, validations, or known failure modes.
- API contracts.
- Environment variables.
- Credentials flow or external integrations.
- Generated reports, benchmarks, dashboards, or evidence artifacts.
- Business, legal, compliance, or operational assumptions.

Code changes that alter behavior must update the relevant docs, or the agent must explicitly state why no documentation update was needed.

## Summary

This handoff covers the latest Vincere Ninja Manager production-readiness pass, including the approved Add All automation test, the safety checks around NinjaTrader orders and positions, and the new scheduled "Get Algos Ready" workflow requested for client morning preparation.

Live strategies were not intentionally enabled. During the Add All test, one NinjaTrader strategy row became enabled as a side effect of the UI workflow, and it was immediately disabled through the active RDP desktop automation.

## Product Changes

- Added a client-facing **Get Algos Ready** button in the Vincere Operator.
- Added settings for a daily ready workflow:
  - `READY_ALGOS_SCHEDULE_ENABLED`
  - `READY_ALGOS_TIME`, defaulting to `08:00` Eastern.
- Updated the Settings panel to include the ready schedule controls and allow scrolling.
- Added scheduler behavior that runs the ready workflow once per trading day inside the configured time window.
- Added startup behavior so the manager can auto-arm itself when the ready schedule is enabled.
- Updated save behavior so the ready schedule also configures the legacy automation windows consistently.
- Added deployment packaging entries for Windows helper scripts used to start NinjaTrader and Vincere Operator before the scheduled ready time.

## Ready Workflow Behavior

The Get Algos Ready flow is intended to prepare accounts for the trading day:

1. Disconnect configured prop firm connections.
2. Wait briefly for the disconnect state to settle.
3. Reconnect configured prop firm connections.
4. Apply the active saved strategy stack.
5. Enable the strategies only when the workflow is allowed to do so.

When the new ready schedule is enabled, the older separate connection, stack-apply, and enable windows are skipped to avoid duplicate automation runs.

## Files Changed

- `.env.example`
  - Added ready schedule keys.
- `.gitignore`
  - Added `backups/` so generated deployment backups are not committed.
- `README.md`
  - Documented the Get Algos Ready workflow and schedule.
- `src/Vincere.Core/Data/Entities.cs`
  - Added persistent marker for the last ready workflow day.
- `src/Vincere.Core/Infrastructure/AppRuntimeConfig.cs`
  - Added ready schedule runtime config keys.
- `src/Vincere.Core/Infrastructure/VincereSchemaPatcher.cs`
  - Added schema patching for the ready workflow day marker.
- `src/Vincere.Core/Services/TradingBotOrchestrator.cs`
  - Added `RunGetAlgosReadyNowAsync`.
  - Added daily scheduler handling.
  - Added prop-firm disconnect/reconnect and strategy-stack preparation sequence.
- `src/Vincere.Operator/MainWindow.xaml`
  - Added Get Algos Ready button and schedule controls.
- `src/Vincere.Operator/MainWindow.xaml.cs`
  - Wired the button, settings persistence, schedule registration, and manual run behavior.
- `src/Vincere.Operator/Vincere.Operator.csproj`
  - Included the Windows startup and task registration scripts in the packaged output.

## Build And Deployment

The first release build was blocked because the running Vincere Operator process had the release DLL locked. A temporary output build succeeded first, then the running operator process was stopped, the normal release build was completed, and the installed app was redeployed.

Successful build command:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore
```

Deployment target:

```text
C:\Users\Administrator\AppData\Local\Programs\VincereOps
```

Deployment backup generated locally:

```text
C:\Users\Administrator\Desktop\vincere-ops\backups\VincereOps-installed-20260527-165425
```

The backup is intentionally ignored by git because it is generated deployment output, not source.

## Readiness Harness

The safe production-readiness harness was run before the approved Add All test.

Latest known report:

```text
logs\production-readiness\20260527-235900\PRODUCTION_READINESS_REPORT.md
```

Result:

```text
PASS=39, FAIL=0, WARN=1, SKIP=10
```

The harness found Add All visible but skipped the live Add All action until explicit approval was given.

## Approved Add All Test

The user explicitly approved running the Add All test.

Pre-test NinjaTrader grid state:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=4
```

The first Add All runner clicked Add All and confirmed the prompt, but did not reach the expected stack log advancement.

The second Add All runner used active RDP desktop automation and confirmed the Add All prompt. The stack apply log advanced, but the stack did not complete successfully.

Add All result details from the stack audit:

```text
APEX1526440000023: failed - instrument selector not found
APEX1526440000024: failed - instrument selector not found
APEX1526440000025: failed - instrument selector not found
APEX1526440000026: failed - instrument selector not found
APEX1526440000027: failed - instrument selector not found
LFE0506703503010: failed - Template load window did not open
```

Post-test NinjaTrader grid state:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=7
```

The Add All flow created partial strategy rows, increasing the Strategies grid from 4 to 7. A safety cleanup was then run through active RDP desktop automation, and final verification showed all strategy rows disabled.

Final verified safety state:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=7
All 7 strategy rows disabled
```

## Scheduled Tasks

Previously-created one-shot tasks for the next morning test were removed after Add All showed partial-row failures:

- `VincereStartManagerTomorrow`
- `VincereVerifySafeStateTomorrow`
- `VincereStopManagerTomorrow`

This prevents an unattended morning run from attempting an unsafe or incomplete Add All/enable sequence.

## Current Readiness Status

Ready:

- VPS repo is on commit `1885362` or newer.
- Operator builds successfully.
- The installed Vincere Operator was redeployed.
- NinjaTrader orders and positions were verified at zero after testing.
- Strategies were visible in NinjaTrader.
- Strategies were verified disabled after cleanup.
- The Get Algos Ready schedule UI and runtime configuration are implemented.

Blocked:

- Add All automation is not production-ready yet.
- NinjaTrader UI automation failed to select instruments for APEX accounts.
- The LFE account failed because the template load window did not open.
- Add All can leave partial strategy rows behind, so unattended live enabling should remain disabled until the UI automation failures are fixed and retested.

## Safety Notes

- Do not enable live strategies without explicit user approval.
- Use the active RDP desktop for NinjaTrader UI automation.
- Do not rely on headless SSH for NinjaTrader UI clicks.
- Confirm `OrdersGrid=0` and `PositionsGrid=0` before and after every readiness or Add All test.
- Confirm all NinjaTrader strategy rows are disabled after any failed or partial Add All run.

## Recommended Next Steps

1. Fix NinjaTrader instrument selector detection in the Add All UI automation.
2. Fix or harden template load handling for the LFE account.
3. Add cleanup logic for partial strategy rows created during failed Add All runs, if NinjaTrader permits safe removal through UI automation.
4. Re-run the safe readiness harness.
5. Re-run the Add All test only after the above automation fixes.
6. Keep live strategy enabling disabled until Add All completes cleanly and the user explicitly approves a live enable test.
