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

This handoff covers the latest Vincere Ninja Manager production-readiness pass, including the approved Add All automation test, the safety checks around NinjaTrader orders and positions, the scheduled "Get Algos Ready" workflow requested for client morning preparation, and the parked WAP/Whop license gate.

Live strategies were not intentionally enabled. During the Add All test, one NinjaTrader strategy row became enabled as a side effect of the UI workflow, and it was immediately disabled through the active RDP desktop automation.

## Product Changes

- Added a client-facing **Get Algos Ready** button in the Vincere Operator.
- Added settings for a daily ready workflow:
  - `READY_ALGOS_SCHEDULE_ENABLED`
  - `READY_ALGOS_TIME`, defaulting to `08:00` Eastern.
  - `READY_ALGOS_ENABLE_STRATEGIES`, defaulting to `false` so readiness can prepare NinjaTrader without live enabling until Add All is verified cleanly.
- Updated the Settings panel to include the ready schedule controls and allow scrolling.
- Added scheduler behavior that runs the ready workflow once per trading day inside the configured time window.
- Added startup behavior so the manager can auto-arm itself when the ready schedule is enabled.
- Updated save behavior so the ready schedule also configures the legacy automation windows consistently.
- Added deployment packaging entries for Windows helper scripts used to start NinjaTrader and Vincere Operator before the scheduled ready time.
- Parked the WAP/Whop license-key flow by default:
  - `VINCERE_LICENSE_UI_ENABLED=false` hides the license status, test button, reset link, and setup wizard license step.
  - `VINCERE_LICENSE_REQUIRED=false` makes onboarding and stack apply non-blocking without a verified key.
  - The backend verification service and Vercel/API config path remain in the code for later re-enablement.

## Ready Workflow Behavior

The Get Algos Ready flow is intended to prepare accounts for the trading day:

1. Disconnect configured prop firm connections.
2. Wait briefly for the disconnect state to settle.
3. Reconnect configured prop firm connections.
4. Apply the active saved strategy stack.
5. Enable the strategies only when `READY_ALGOS_ENABLE_STRATEGIES=true`; otherwise leave strategies disabled after preparation.

When the new ready schedule is enabled, the older separate connection, stack-apply, and enable windows are skipped to avoid duplicate automation runs.

## Files Changed

- `.env.example`
  - Added ready schedule keys and an explicit strategy-enable safety gate.
  - Added license gate flags so WAP/Whop verification is hidden and non-blocking by default.
- `.gitignore`
  - Added `backups/` so generated deployment backups are not committed.
- `README.md`
  - Documented the Get Algos Ready workflow and schedule.
- `scripts/Test-VincereProductionReadiness.ps1`
  - Verifies the Get Algos Ready schedule controls and explicit strategy-enable safety gate in the screenshot-backed readiness harness.
  - Verifies the default dashboard/settings UI does not visibly expose the WAP/Whop license-key controls.
- `scripts/Send-AgentCheckpointTelegram.py`
  - Adds a non-secret checkpoint sender for agent status updates; it reads Telegram token/chat values from environment variables or the Agent Phoenix ProjectX `.env`.
- `scripts/Invoke-NinjaTraderUiStackSetup.ps1`
  - Hardened instrument selector lookup by scrolling/focusing the Strategy dialog Properties panel before searching.
  - Restored the intended instrument flow: type the root symbol, click the NinjaTrader `Futures` suggestion when visible, and only fall back to an explicit current contract if no suggestion appears.
- `src/Vincere.Core/Data/Entities.cs`
  - Added persistent marker for the last ready workflow day.
- `src/Vincere.Core/Infrastructure/AppRuntimeConfig.cs`
  - Added ready schedule runtime config keys.
  - Added `VINCERE_LICENSE_UI_ENABLED` and `VINCERE_LICENSE_REQUIRED`.
- `src/Vincere.Core/Services/StackApplyService.cs`
  - License verification blocks stack apply only when `VINCERE_LICENSE_REQUIRED=true`.
- `src/Vincere.Core/Infrastructure/VincereSchemaPatcher.cs`
  - Added schema patching for the ready workflow day marker.
- `src/Vincere.Core/Services/TradingBotOrchestrator.cs`
  - Added `RunGetAlgosReadyNowAsync`.
  - Added daily scheduler handling.
  - Added prop-firm disconnect/reconnect and strategy-stack preparation sequence.
- `src/Vincere.Operator/MainWindow.xaml`
  - Added Get Algos Ready button, schedule controls, and the explicit enable-strategies toggle.
  - Hid the dashboard/settings license controls unless the license gate is explicitly enabled.
- `src/Vincere.Operator/MainWindow.xaml.cs`
  - Wired the button, settings persistence, schedule registration, and manual run behavior.
  - Added Add All batch audit logging and stop-on-first-failure behavior so partial setup failures are captured instead of continuing silently across all accounts.
  - Keeps the license-test handlers available only behind the hidden/re-enabled UI path.
- `src/Vincere.Operator/OnboardingWindow.xaml`
  - Hid the setup wizard license step and license gate panel by default.
- `src/Vincere.Operator/OnboardingWindow.xaml.cs`
  - Skips license verification unless `VINCERE_LICENSE_REQUIRED=true`.
- `src/Vincere.Operator/Vincere.Operator.csproj`
  - Included the Windows startup and task registration scripts in the packaged output.

## Build And Deployment

The first release build was blocked because the running Vincere Operator process had the release DLL locked. A temporary output build succeeded first, then the running operator process was stopped, the normal release build was completed, and the installed app was redeployed.

Successful build command:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore
```

### 2026-05-28 Verification Baseline

- Commit deployed on VPS: `fcc93ab` (`Update handoff for instrument selector hardening`).
- VPS repo: `C:\Users\Administrator\Desktop\vincere-ops`.
- Installed app redeployed from the clean committed release build.
- Latest deployment backup: `C:\Users\Administrator\Desktop\vincere-ops\backups\VincereOps-installed-20260528-182050`.
- Target Windows build passed:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

Result: `0 Warning(s), 0 Error(s)`.

- Safe screenshot-backed harness report:
  `C:\Users\Administrator\Desktop\vincere-ops\logs\production-readiness\20260528-181142\PRODUCTION_READINESS_REPORT.md`
- Harness summary: `PASS=42, FAIL=0, WARN=1, SKIP=10`.
- Verified controls:
  - `Automatically get algos ready each trading day`.
  - `Enable strategies after Get Algos Ready`.
  - Safety copy warning to leave strategy enabling off until Add All is verified.
- NinjaTrader verification:
  - Strategies grid visible to UI Automation.
  - UIA data item count: `3`.
  - Enable what-if: would set `3 of 3` rows enabled.
  - Disable what-if: all `3` strategy rows were already disabled.
- Running process state after deploy/test:
  - `NinjaTrader`, PID `13916`, responding in the earlier 2026-05-28 process check.
  - `Vincere.Operator`, PID `15432`, responding in the earlier 2026-05-28 process check.
- Temporary one-off scheduled test tasks were removed after the run.
- The Add All batch audit hardening builds and is deployed, but still needs a supervised Add All test before it can be considered behaviorally verified.
- The instrument-selector script passed a PowerShell parser check after the final VPS pull and was redeployed into the installed app folder.

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
- Get Algos Ready now leaves strategies disabled by default unless `READY_ALGOS_ENABLE_STRATEGIES=true`.
- Add All now stops on the first failed account and writes a JSON batch audit under `logs/stack-apply-batches/` so support can see which accounts were attempted.
- The setup script now prefers NinjaTrader's visible `Futures` instrument suggestion instead of forcing an explicit contract first.

Blocked:

- Add All automation is not production-ready yet.
- NinjaTrader UI automation needs a supervised Add All retest to confirm the instrument-selector hardening fixes the APEX account failures.
- The LFE account failed because the template load window did not open.
- Add All can still leave strategy rows from the failed account itself, so unattended live enabling should remain disabled until row verification and rollback/cleanup are implemented and retested.

## Safety Notes

- Do not enable live strategies without explicit user approval.
- Keep `READY_ALGOS_ENABLE_STRATEGIES=false` until Add All completes cleanly and a human approves live enable behavior for the client.
- Use the active RDP desktop for NinjaTrader UI automation.
- Do not rely on headless SSH for NinjaTrader UI clicks.
- Confirm `OrdersGrid=0` and `PositionsGrid=0` before and after every readiness or Add All test.
- Confirm all NinjaTrader strategy rows are disabled after any failed or partial Add All run.

## Recommended Next Steps

1. Fix NinjaTrader instrument selector detection in the Add All UI automation.
2. Fix or harden template load handling for the LFE account.
3. Add row verification and cleanup/rollback logic for partial strategy rows created during failed Add All runs, if NinjaTrader permits safe removal through UI automation.
4. Re-run the safe readiness harness.
5. Re-run the Add All test only after the above automation fixes.
6. Keep live strategy enabling disabled until Add All completes cleanly and the user explicitly approves a live enable test.
