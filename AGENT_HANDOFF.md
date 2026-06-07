# Vincere Ninja Manager Agent Handoff

Date: 2026-05-28
Repo: vincere-ops
VPS workspace: `C:\Users\Administrator\Documents\Projects\Vincere\vincere-ops`
Baseline verified commit: `878a9a5` or newer

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
- `scripts/Deploy-VincereOperatorInstalled.ps1`
  - Resolves the repo root from the script location instead of the old Desktop path.
- `scripts/Start-VincereProductionReadinessTask.ps1`
  - Uses the installed app path by default so the interactive QA task validates the deployed executable.

## Build And Deployment

The first release build was blocked because the running Vincere Operator process had the release DLL locked. A temporary output build succeeded first, then the running operator process was stopped, the normal release build was completed, and the installed app was redeployed.

Successful build command:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore
```

### 2026-05-28 Verification Baseline

- Commit deployed on VPS: `878a9a5` (`Use installed app in readiness task`).
- VPS repo: `C:\Users\Administrator\Documents\Projects\Vincere\vincere-ops`.
- Installed app redeployed from the clean committed release build.
- Latest deployment backup: `C:\Users\Administrator\Documents\Projects\Vincere\vincere-ops\backups\VincereOps-installed-20260528-205127`.
- Target Windows build passed:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

Result: `0 Warning(s), 0 Error(s)`.

- Safe screenshot-backed harness report:
  `C:\Users\Administrator\Documents\Projects\Vincere\vincere-ops\logs\production-readiness\20260528-205726\PRODUCTION_READINESS_REPORT.md`
- Harness summary: `PASS=45, FAIL=0, WARN=1, SKIP=10`.
- Verified controls:
  - `Automatically get algos ready each trading day`.
  - `Enable strategies after Get Algos Ready`.
  - Safety copy warning to leave strategy enabling off until Add All is verified.
  - WAP/Whop license status and license-key/test controls are hidden by default.
- NinjaTrader verification:
  - Strategies grid visible to UI Automation.
  - UIA data item count: `6`.
  - Enable what-if: would set `6 of 6` rows enabled.
  - Disable what-if: all `6` strategy rows were already disabled.
- Running process state after deploy/test:
  - `NinjaTrader`, PID `12396`, responding in the 2026-05-28 process check after the readiness run.
  - `Vincere.Operator`, PID `10928`, responding in the 2026-05-28 process check after the readiness run.
- Temporary one-off scheduled test tasks were removed after the run.
- The Add All batch audit hardening builds and is deployed, but still needs a supervised Add All test before it can be considered behaviorally verified.
- The instrument-selector script passed a PowerShell parser check after the final VPS pull and was redeployed into the installed app folder.

Deployment target:

```text
C:\Users\Administrator\AppData\Local\Programs\VincereOps
```

Deployment backup generated locally:

```text
C:\Users\Administrator\Documents\Projects\Vincere\vincere-ops\backups\VincereOps-installed-20260528-205127
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

## 2026-06-06 Static Add All Safety Audit

Scope: local static audit only from `C:\Users\Administrator\Documents\Projects\Vincere\Automation`. No RDP, browser GUI, external messaging, secret access, GitHub push, live strategy enabling, scheduled-task changes, NinjaTrader clicks, or production-impacting actions were performed. `READY_ALGOS_ENABLE_STRATEGIES` remains documented as `false` in `.env.example` and must stay false until Add All is verified cleanly and live enable behavior is explicitly approved.

Checked:

- Read this handoff first and ran `git status --short --branch`.
- Reviewed `src/Vincere.Operator/MainWindow.xaml.cs` Add All orchestration.
- Reviewed `src/Vincere.Core/Services/StackApplyService.cs` stack apply execution and audit logging.
- Reviewed `scripts/Invoke-NinjaTraderUiStackSetup.ps1` instrument selector, template load, dialog cancel, OK confirmation, and per-strategy loop handling.
- Reviewed `src/Vincere.Operator/NinjaTraderUiDiscovery.cs`, `scripts\Probe-NinjaTraderGridCounts.ps1`, `scripts\Set-NinjaTraderStrategiesEnabled.ps1`, and `scripts\Test-VincereProductionReadiness.ps1` for existing grid-count and strategy-disabled verification paths.

Findings:

- Add All still stops after the first failed account and writes a batch audit under `logs\stack-apply-batches`, which is good containment.
- `Invoke-NinjaTraderUiStackSetup.ps1` cancels the active Strategy dialog on an exception before rethrowing, which helps avoid leaving the current dialog open.
- Instrument selector lookup is still the main APEX risk area. The script now scrolls/focuses the Properties panel, retries `InstrumentSelector`, types the root, prefers a visible Futures suggestion, and falls back to an explicit current contract. This has only static/parser validation in this session; it still needs supervised RDP proof against the real NT8 dialog.
- LFE template-load handling still has a gap. The script finds a local/default template path, opens the template slideout, searches for `load`, invokes it, then waits up to 8 seconds for a Load/Open/template picker window. If the window does not appear, it throws `Template load window did not open.` There is no retry of an alternate template-load invocation path after that failure and no diagnostic tree for the missing window case.
- Partial strategy-row cleanup/rollback is not implemented. The code can cancel the currently open dialog after an exception, but once a previous strategy dialog has been confirmed with OK, there is no row-count baseline, no expected row-delta verification, no duplicate detection, and no automatic removal/rollback of rows added before a later failure.
- Existing safety tooling can observe or force-disabled strategies, but it does not prove Add All rollback. `Probe-NinjaTraderGridCounts.ps1` can report `OrdersGrid`, `PositionsGrid`, and `StrategiesGrid`; `Set-NinjaTraderStrategiesEnabled.ps1 -Enabled:$false -WhatIf` can report would-disable state, and without `-WhatIf` can disable visible strategy checkboxes under supervision.

Tests run:

```powershell
git status --short --branch
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null
```

Result: working tree was clean before this handoff edit; `Invoke-NinjaTraderUiStackSetup.ps1` parser check passed. No build, readiness harness, RDP UI automation, NinjaTrader process interaction, live Add All, live enable/disable, Telegram, browser, or GitHub operation was run.

Next supervised RDP checklist before any future Add All UI test:

1. Confirm the active RDP desktop is visible and stable; do not run Add All from headless SSH.
2. Confirm `READY_ALGOS_ENABLE_STRATEGIES=false` in `%LocalAppData%\Vincere.Operator\.env` or effective runtime settings.
3. Confirm NinjaTrader Control Center is open and the target account set is the intended client test set.
4. Run or manually verify grid counts before Add All and record exact values:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=<baseline>
All visible strategy rows disabled
```

5. If `OrdersGrid` or `PositionsGrid` is not zero, stop. Do not run Add All.
6. If any strategy row is enabled before the test, stop and disable under supervision before proceeding.
7. Run Add All only with explicit human approval and screen observation.
8. On the first failure, stop further account attempts. Preserve the batch audit JSON and stack apply log.
9. Immediately verify post-test safety and record exact values:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=<post-test>
All visible strategy rows disabled
```

10. If any row is enabled after the test, disable strategies immediately under supervision and recheck until all visible rows are disabled.
11. Compare `StrategiesGrid=<post-test>` with the baseline. If the count increased after a failed or partial Add All, treat those rows as partial leftovers; do not schedule unattended readiness or live enable until cleanup/rollback is implemented or the rows are manually reconciled and documented.
12. Re-run the safe readiness harness after any code changes and before any live enable-path test.

## 2026-06-06 Diagnostic Source Change Plan

Added `docs/VINCERE_ADD_ALL_DIAGNOSTIC_SOURCE_CHANGE_PLAN.md` as a documentation-only source-change plan for the later Kush-approved diagnostic Add All slice. It anchors exact files/functions, proposed audit schema fields, validation commands, and approval gates for APEX selector diagnostics, one fail-closed LFE template-load retry/diagnostics, and row-baseline/row-delta audit detection with no automatic deletion. No source code, RDP, NinjaTrader action, live enable, production behavior, GitHub, secrets, or global Git config changes were made.

## 2026-06-06 War Machine Review

Reviewed `docs\VINCERE_ADD_ALL_DIAGNOSTIC_SOURCE_CHANGE_PLAN.md` and this handoff for readiness to ask Kush for implementation approval. Documentation-only review; no source code, RDP, NinjaTrader clicks, strategy enabling, production behavior changes, GitHub push, secrets, or global Git config changes were performed.

ready_for_kush_approval: yes

Missing details: none blocking. The plan is complete enough to ask Kush for approval because it defines the diagnostic-only scope, exact source anchors, shared diagnostic identity/path, bounded snapshot rules, fail-closed behavior, proposed batch audit schema, validation commands, and approval gates. Minor implementation choices can be resolved during code work without expanding scope: final method/type names, exact local data-directory resolver, and the safest way to extend readiness-harness assertions without invoking live Add All.

Explicit safety gates:

- Kush must approve implementation before any source code changes.
- Implementation must remain diagnostic-only: APEX selector diagnostics, one fail-closed LFE template-load retry/diagnostics, and row-baseline/row-delta audit detection.
- No automatic strategy-row deletion in this slice.
- No strategy enabling, live enable-path test, scheduled-task changes, or production behavior changes.
- Keep `READY_ALGOS_ENABLE_STRATEGIES=false`.
- Any uncertain order count, position count, strategy grid count, or visible enabled-state read must fail closed.
- Parser check, Release build, and safe readiness harness without live Add All must pass before any supervised retest is proposed.
- Kush must separately approve the exact supervised RDP retest window, target account set, acceptable baseline `StrategiesGrid`, pre-test `OrdersGrid=0`, pre-test `PositionsGrid=0`, all visible strategy rows disabled, and the final Add All click/run action.
- Separate later approval is required for automatic partial-row deletion/cleanup, any live enable-path test, or changing `READY_ALGOS_ENABLE_STRATEGIES=true`.

## 2026-06-06 Iron Man Approval Brief

Purpose: approval-ready brief for the next diagnostic-only Add All implementation slice. This brief does not approve or perform code changes. No source code, RDP, NinjaTrader UI action, strategy enabling, production behavior change, GitHub push, secrets access, or global Git config change was performed. `READY_ALGOS_ENABLE_STRATEGIES` must remain `false`.

Exact diagnostic-only scope:

- Add APEX instrument selector diagnostics: staged breadcrumbs, bounded Strategy dialog / Properties UI tree snapshots on selector failure, and concise diagnostic path summaries in stack apply output.
- Add one fail-closed LFE template-load missing-window retry: capture template path/slideout/load-control/window state, retry load invocation exactly once if no picker/window appears, then fail closed with diagnostic path if still missing.
- Add row-baseline / row-delta audit detection: read-only pre/post `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, visible enabled/disabled strategy counts, uncertainty reasons, `partial_rows_left`, and `manual_cleanup_required` audit fields.
- Preserve stop-on-first-failure behavior.
- Add no automatic row deletion or cleanup.
- Any uncertain order count, position count, strategy grid count, or visible enabled-state read must fail closed and must not mark the batch safe.

Exact files/functions to edit after approval:

- `scripts/Invoke-NinjaTraderUiStackSetup.ps1`
  - `Find-InstrumentFuturesSuggestion`
  - `Find-InstrumentSelector`
  - `Set-Instrument`
  - `Try-ScrollIntoView`
  - `Write-ElementDebugTree`
  - `Show-TemplateSlideout`
  - `Load-Template`
  - `Find-VisibleDescendantByName`
  - `Invoke-OrClickElement`
  - `Cancel-StrategiesDialog`
- `src/Vincere.Operator/NinjaTraderUiDiscovery.cs`
  - add a read-only grid safety snapshot result/method
  - use existing `FindControlCenter`, `TrySelectTab`, and `IsVisibleEnabled`
  - use `SetAllStrategiesEnabled` only as a reference for checkbox reading; do not enable or disable strategies in this slice
- `src/Vincere.Operator/MainWindow.xaml.cs`
  - `ApplyAttachTargetsAsync`
  - `WriteAttachBatchAuditAsync`
  - `AttachTarget` if needed for audit context
- `src/Vincere.Core/Services/StackApplyService.cs`
  - `ExecuteAsync`
  - `AppendApplyLogAsync`
  - `TryExecuteUiAutomationAsync`

Validation commands to run after Kush approves implementation and code changes are made:

```powershell
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
.\scripts\Test-VincereProductionReadiness.ps1
rg -n "partial_rows_left|diagnostic_run_id|pre_grid_state|post_grid_state|manual_cleanup_required" src scripts
rg -n "READY_ALGOS_ENABLE_STRATEGIES=false" .env.example README.md AGENT_HANDOFF.md docs
```

Validation constraints:

- Do not pass `-IncludeLiveAddAll`.
- Do not run live enable/disable switches.
- Do not run RDP automation.
- Do not click NinjaTrader.
- Do not change scheduled tasks.
- Do not push to GitHub.

Explicitly out of scope:

- Live strategy enabling.
- Changing `READY_ALGOS_ENABLE_STRATEGIES=true`.
- Running Add All.
- RDP / NinjaTrader UI clicks.
- Automatic strategy-row deletion or cleanup.
- Production scheduling changes.
- Secret access, external messaging, or GitHub push.
- Any live enable-path test.

Exact approval question for Kush:

```text
Kush, do you approve implementing only the diagnostic Add All slice described in the 2026-06-06 Iron Man Approval Brief: APEX selector diagnostics, exactly one fail-closed LFE template-load retry/diagnostics, and row-baseline/row-delta audit detection, with READY_ALGOS_ENABLE_STRATEGIES kept false, no live strategy enabling, no RDP/NinjaTrader clicks during implementation validation, no production behavior changes beyond fail-closed diagnostics, and no automatic strategy-row deletion?
```

## 2026-06-06 Next Diagnostic-Only Add All Slice Checklist

Purpose: durable checklist for the next implementation cycle. This section narrows the work to a diagnostic-only source patch after Kush approval. It is not approval to edit code, run RDP, click NinjaTrader, enable strategies, use secrets, push, delete strategy rows, or change production behavior. `READY_ALGOS_ENABLE_STRATEGIES` must remain `false`.

Implementation scope after approval:

1. APEX instrument selector diagnostics only.
   - Edit `scripts/Invoke-NinjaTraderUiStackSetup.ps1`.
   - Anchor functions: `Find-InstrumentSelector`, `Set-Instrument`, `Find-InstrumentFuturesSuggestion`, `Try-ScrollIntoView`, `Write-ElementDebugTree`.
   - Add bounded breadcrumbs for selector lookup stages: initial lookup, Properties panel visibility/focus, post-scroll lookup, textbox target, root typed, Futures suggestion found/selected, fallback contract entered, and final selector failure.
   - On selector failure, write bounded Strategy dialog / Properties tree snapshots and return the diagnostic path in the account result.
   - Fail closed if selector state remains uncertain. Do not confirm the Strategy dialog.

2. LFE template-load retry and diagnostics only.
   - Edit `scripts/Invoke-NinjaTraderUiStackSetup.ps1`.
   - Anchor functions: `Load-Template`, `Show-TemplateSlideout`, `Find-VisibleDescendantByName`, `Invoke-OrClickElement`, `Write-ElementDebugTree`, `Cancel-StrategiesDialog`.
   - Record resolved template path, default-template fallback, slideout/header/load-control state, invocation method, wait start, and whether a Load/Open/template window appears.
   - If no window appears after the first load invocation, retry exactly once by refocusing the Strategy dialog, reacquiring the slideout/load control, and invoking/clicking load again.
   - If the second attempt fails, throw with diagnostic path. Do not skip template loading, choose a different template, or confirm the Strategy dialog.

3. Row-baseline / row-delta audit detection only.
   - Edit `src/Vincere.Operator/NinjaTraderUiDiscovery.cs`, `src/Vincere.Operator/MainWindow.xaml.cs`, and only if needed `src/Vincere.Core/Services/StackApplyService.cs`.
   - Anchor functions: `NinjaTraderUiDiscovery.FindControlCenter`, `TrySelectTab`, `IsVisibleEnabled`, `ApplyAttachTargetsAsync`, `WriteAttachBatchAuditAsync`, `StackApplyService.ExecuteAsync`, `AppendApplyLogAsync`, `TryExecuteUiAutomationAsync`.
   - Add a read-only grid safety snapshot: `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, visible enabled strategy count, visible disabled strategy count, uncertainty flags, and read error.
   - Capture pre/post snapshot for each Add All account attempt.
   - Block before an attempt if orders or positions are nonzero, any visible strategy row is enabled, or any required read is uncertain.
   - If an account fails and `StrategiesGrid` increased, set `partial_rows_left=true` and `manual_cleanup_required=true` in the batch audit.
   - Do not automatically delete, disable, or clean up strategy rows in this slice.

Audit fields that must exist after implementation:

```text
schema_version
diagnostic_run_id
diagnostic_root
pre_grid_state
post_grid_state
orders_grid_count
positions_grid_count
strategies_grid_count
visible_strategy_enabled_count
visible_strategy_disabled_count
enabled_state_uncertain
grid_count_uncertain
partial_rows_left
manual_cleanup_required
diagnostic_paths
fail_closed_reasons
safety_completion
```

Validation commands after implementation approval and source edits:

```powershell
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
.\scripts\Test-VincereProductionReadiness.ps1
rg -n "partial_rows_left|diagnostic_run_id|pre_grid_state|post_grid_state|manual_cleanup_required" src scripts
rg -n "READY_ALGOS_ENABLE_STRATEGIES=false" .env.example README.md AGENT_HANDOFF.md docs
```

Validation stop lines:

- Do not pass `-IncludeLiveAddAll`.
- Do not run live enable/disable switches.
- Do not run RDP automation.
- Do not click NinjaTrader.
- Do not change scheduled tasks.
- Do not push to GitHub.
- Do not proceed to supervised Add All retest unless parser check, Release build, and safe readiness harness pass.

Approval gate for Kush before any code changes:

```text
Kush, do you approve one diagnostic-only source patch for Add All safety covering only APEX selector diagnostics, exactly one fail-closed LFE template-load retry/diagnostics, and row-baseline/row-delta audit detection, with READY_ALGOS_ENABLE_STRATEGIES kept false, no live strategy enabling, no RDP/NinjaTrader clicks during validation, no production behavior changes beyond fail-closed diagnostics, and no automatic strategy-row deletion?
```

## 2026-06-06 Kush Approval Request Refresh

Checked:

- `AGENT_HANDOFF.md`
- `docs\VINCERE_ADD_ALL_DIAGNOSTIC_SOURCE_CHANGE_PLAN.md`
- Current git status

Approval request to send to Kush:

```text
Kush, do you approve one diagnostic-only source patch for Add All safety covering only APEX selector diagnostics, exactly one fail-closed LFE template-load retry/diagnostics, and row-baseline/row-delta audit detection, with READY_ALGOS_ENABLE_STRATEGIES kept false, no live strategy enabling, no RDP/NinjaTrader clicks during validation, no production behavior changes beyond fail-closed diagnostics, and no automatic strategy-row deletion?
```

Implementation status: blocked until Kush answers yes to the exact approval request above. Until then, do not edit source code, run RDP/NinjaTrader UI actions, enable or disable strategies, change scheduled tasks, use secrets, push to GitHub, change production behavior, or add automatic strategy-row deletion. `READY_ALGOS_ENABLE_STRATEGIES` must remain `false`.

## 2026-06-06 War Machine Add All Evidence Refresh

Scope: read-only diagnostics review of Add All blocker evidence and existing handoff/readiness notes. No RDP, NinjaTrader clicks, strategy enabling, production behavior changes, secrets, GitHub push, or global Git config changes were performed.

Current evidence:

- APEX accounts failed in the approved Add All test with repeated `instrument selector not found` results. Static notes show the setup script now tries Properties-panel focus/scroll, root typing, visible `Futures` suggestion selection, and current-contract fallback, but this still lacks supervised live-dialog proof.
- LFE failed with `Template load window did not open`. Current plan covers resolved-template diagnostics, slideout/load-control diagnostics, top-level window capture, and exactly one fail-closed retry. No alternate template selection or skip behavior is approved.
- Failed Add All left partial strategy rows: `StrategiesGrid` moved from `4` before the test to `7` after failure. Final safety evidence recorded `OrdersGrid=0`, `PositionsGrid=0`, `StrategiesGrid=7`, and all 7 strategy rows disabled after supervised cleanup. Automatic row deletion is not implemented or approved.

Smallest safe next implementation slice:

- Add diagnostic-only APEX selector breadcrumbs and bounded UI tree snapshots in `scripts\Invoke-NinjaTraderUiStackSetup.ps1`.
- Add diagnostic-only LFE template-load state capture plus one fail-closed missing-window retry.
- Add read-only pre/post Add All grid snapshots and row-delta audit fields: orders, positions, strategy count, visible enabled/disabled strategy counts, uncertainty reasons, `partial_rows_left`, and `manual_cleanup_required`.
- Preserve stop-on-first-failure. Keep `READY_ALGOS_ENABLE_STRATEGIES=false`. Do not add automatic row deletion, cleanup, strategy enabling, scheduled-task changes, or live Add All validation in the implementation pass.

Required pre/post safety checks for any future supervised Add All retest:

- Before: confirm `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, baseline `StrategiesGrid=<count>`, and all visible strategy rows disabled.
- Stop before Add All if orders or positions are nonzero, any visible strategy row is enabled, or any required grid/enabled-state read is uncertain.
- After: immediately record `OrdersGrid=0`, `PositionsGrid=0`, post-test `StrategiesGrid=<count>`, all visible strategy rows disabled, batch audit JSON, stack apply log, and diagnostic snapshot paths.
- If `StrategiesGrid` increases after a failed account, mark partial rows left and require manual supervised reconciliation before any unattended readiness or live enable path.

Still requires Kush approval:

- Approval to implement the diagnostic-only source slice.
- Approval of the exact supervised RDP retest window, target account set, and acceptable baseline strategy rows.
- Explicit approval immediately before any Add All click/run after pre-test safety state is recorded.
- Separate later approval for automatic partial-row deletion/cleanup, any live enable-path test, or changing `READY_ALGOS_ENABLE_STRATEGIES=true`.

## 2026-06-06 Cycle Note

Read `AGENT_HANDOFF.md`, `docs\VINCERE_ADD_ALL_DIAGNOSTIC_SOURCE_CHANGE_PLAN.md`, and ran `git status --short --branch`. The diagnostic-only Add All implementation request is still blocked only on Kush approval. No new blocker was found. The next allowed implementation remains limited to APEX selector diagnostics, exactly one fail-closed LFE template-load retry/diagnostics, and read-only row-baseline/row-delta audit detection. Keep `READY_ALGOS_ENABLE_STRATEGIES=false`; do not run RDP/NinjaTrader UI actions, enable or disable strategies, change scheduled tasks, alter production behavior, delete/cleanup strategy rows, use secrets, or push to GitHub.

## 2026-06-07 Add All Safety Handoff

Checked:

- `AGENT_HANDOFF.md`
- Current repo status with `git status --short --branch`

Current approval status:

- Diagnostic-only source implementation remains blocked until Kush explicitly approves it.
- The pending approval request is limited to APEX selector diagnostics, exactly one fail-closed LFE template-load retry/diagnostics, and read-only row-baseline/row-delta audit detection.
- `READY_ALGOS_ENABLE_STRATEGIES` must remain `false`.

Known blockers:

- APEX instrument selector: previous supervised Add All evidence showed repeated `instrument selector not found` failures. The current script has static hardening, but it still needs diagnostic breadcrumbs and supervised proof against the live NT8 dialog.
- LFE template load: previous evidence showed `Template load window did not open`. The next repair must add missing-window diagnostics and exactly one fail-closed retry; it must not skip template loading or auto-select a different template.
- Partial strategy rows: previous failed Add All increased `StrategiesGrid` from `4` to `7`. Detection and audit proof are still missing. Automatic strategy-row deletion/cleanup is not approved.

Smallest safe next repair candidate:

- Add diagnostic-only breadcrumbs and bounded UI snapshots for APEX selector lookup in `scripts\Invoke-NinjaTraderUiStackSetup.ps1`.
- Add LFE template-load state capture plus exactly one fail-closed missing-window retry in `scripts\Invoke-NinjaTraderUiStackSetup.ps1`.
- Add read-only pre/post Add All grid snapshots and row-delta audit fields in the Operator flow: orders count, positions count, strategy count, visible enabled/disabled strategy counts, uncertainty flags, `partial_rows_left`, and `manual_cleanup_required`.
- Preserve stop-on-first-failure. Do not enable/disable strategies, delete rows, change scheduled tasks, push to GitHub, use secrets, or change production behavior.

Supervised RDP test checklist for any future retest:

1. Kush approves the exact RDP retest window, target account set, and acceptable baseline strategy rows.
2. Confirm active RDP desktop is visible and stable; do not run from headless SSH.
3. Confirm `READY_ALGOS_ENABLE_STRATEGIES=false`.
4. Before Add All, record:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=<baseline>
All visible strategy rows disabled
```

5. Stop before Add All if orders or positions are nonzero, any visible strategy row is enabled, or any grid/enabled-state read is uncertain.
6. Kush gives explicit approval to click/run Add All after the pre-test state is recorded.
7. On first failed account, stop further account attempts and preserve batch audit JSON, stack apply log, and diagnostic snapshots.
8. Immediately after test/failure, record:

```text
OrdersGrid=0
PositionsGrid=0
StrategiesGrid=<post-test>
All visible strategy rows disabled
```

9. If `StrategiesGrid` increased after a failed account, mark partial rows left and require manual supervised reconciliation before any unattended readiness or live enable path.

## 2026-06-07 Cycle Note

Read `AGENT_HANDOFF.md`, `docs\VINCERE_ADD_ALL_DIAGNOSTIC_SOURCE_CHANGE_PLAN.md`, and ran `git status --short --branch`. The diagnostic-only Add All approval request remains complete/current; no missing approval wording was found. Current status is still approval-blocked until Kush explicitly approves the diagnostic-only source patch. Next safe step: ask Kush to approve only APEX selector diagnostics, exactly one fail-closed LFE template-load retry/diagnostics, and read-only row-baseline/row-delta audit detection, with `READY_ALGOS_ENABLE_STRATEGIES=false`, no RDP/NinjaTrader UI actions during validation, no strategy enable/disable, no scheduled-task changes, no production behavior changes, and no automatic row deletion.

## 2026-06-07 Diagnostic Add All Source Patch

Kush explicitly approved the standing narrow diagnostic-only Add All source patch in chat. Implemented only the diagnostic/fail-closed source patch. No RDP, browser, NinjaTrader UI click, live Add All run, strategy enable/disable, scheduled-task change, automatic row deletion/cleanup, GitHub push, production deploy, or secret access was performed.

Files changed:

- `scripts\Invoke-NinjaTraderUiStackSetup.ps1`: added diagnostic run id/root, bounded event/path writers, APEX instrument selector breadcrumbs and failure snapshots, template-load state diagnostics, top-level window snapshots, and exactly one fail-closed missing-window retry.
- `src\Vincere.Operator\NinjaTraderUiDiscovery.cs`: added read-only `NinjaTraderGridSafetySnapshot` and `GetGridSafetySnapshotAsync` for Orders, Positions, Strategies, visible enabled/disabled strategy rows, uncertainty flags, and read errors.
- `src\Vincere.Operator\MainWindow.xaml.cs`: added pre/post grid snapshots around each Add All account attempt, pre-attempt fail-closed blocking on unsafe/uncertain grid state, row-delta partial-row detection, post-attempt unsafe-state fail-closed audit marking, `manual_cleanup_required`, `partial_rows_left`, `fail_closed_reasons`, `diagnostic_paths`, `schema_version=2`, `diagnostic_run_id`, and `diagnostic_root` in batch audit JSON.
- `AGENT_HANDOFF.md`: recorded this implementation, validation, residual risks, and next approval gates.

Commands run:

```powershell
git status --short --branch
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null; Write-Output "PARSER_OK"
rg -n "partial_rows_left|diagnostic_run_id|pre_grid_state|post_grid_state|manual_cleanup_required|GetGridSafetySnapshot|Template load window did not open after one retry" src scripts
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
rg -n "READY_ALGOS_ENABLE_STRATEGIES=false" .env.example README.md AGENT_HANDOFF.md docs
git diff --stat
git diff --check
```

Test results:

- PowerShell parser check passed with `PARSER_OK`.
- Static field search found the expected diagnostic/audit symbols in `src` and `scripts`.
- Release build passed with `0 Warning(s), 0 Error(s)`.
- `READY_ALGOS_ENABLE_STRATEGIES=false` search still passes in `.env.example`, handoff, and docs.
- `git diff --check` passed with only Git line-ending warnings (`LF will be replaced by CRLF`); no whitespace errors were reported.
- Safe readiness harness was not run in this cycle because the user explicitly prohibited browser/RDP/NinjaTrader UI actions and the harness is not a purely static check in this environment.

Residual risks:

- The new diagnostics and row-delta safety audit are build/parser verified only; they are not behaviorally proven against a live NinjaTrader Strategy dialog.
- The read-only grid snapshot still uses UI Automation tab selection during a future Add All flow. It does not toggle strategies or delete rows, but it must be validated from a visible supervised desktop.
- Diagnostic roots may differ between Operator batch audit (`DataDirectory\logs\add-all-diagnostics\<batchId>`) and PowerShell fallback diagnostics (`%TEMP%\vincere-add-all-diagnostics\<runId>`) until a supervised run confirms the captured paths in stack apply output.
- Automatic partial-row deletion/cleanup remains intentionally unimplemented and unapproved.

Next steps requiring separate Kush approval:

- Run the safe readiness harness from a visible/unlocked desktop, without `-IncludeLiveAddAll`.
- Approve the exact supervised RDP Add All retest window, target account set, and acceptable baseline `StrategiesGrid`.
- Immediately before any Add All retest, confirm `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, and all visible strategy rows disabled.
- Separately approve any Add All click/run, any automatic partial-row deletion/cleanup design, any live enable-path test, or any change to `READY_ALGOS_ENABLE_STRATEGIES=true`.

## 2026-06-07 Static Review Of Diagnostic Patch

Review scope: read `AGENT_HANDOFF.md`, ran `git status --short --branch`, and inspected only changed files: `scripts\Invoke-NinjaTraderUiStackSetup.ps1`, `src\Vincere.Operator\MainWindow.xaml.cs`, and `src\Vincere.Operator\NinjaTraderUiDiscovery.cs`. No RDP, browser, NinjaTrader UI automation, live Add All, strategy enable/disable, scheduled-task change, deploy, GitHub push, secrets, or production-impacting action was performed. Parser/build/readiness checks were not rerun in this pass.

Changed-file status at review time:

- `AGENT_HANDOFF.md`
- `scripts\Invoke-NinjaTraderUiStackSetup.ps1`
- `src\Vincere.Operator\MainWindow.xaml.cs`
- `src\Vincere.Operator\NinjaTraderUiDiscovery.cs`
- untracked `docs\`

Finding:

- Blocker before supervised retest: `src\Vincere.Operator\MainWindow.xaml.cs` records `postGridUnsafe` and sets `safetyCompletion = "failed"` when an account returns `ok=true` but the post-attempt grid snapshot is unsafe or uncertain. However, the visible result line still reports `OK`, `failed` is later derived only from `": FAIL"` text, and the loop only breaks on `!ok`. This can produce an informational completion message and continue to the next account, or finish a one-account batch, even though the audit marks unsafe/manual cleanup. The repair should make post-attempt unsafe/uncertain state fail closed in the user-visible result and stop further attempts, without enabling/disabling strategies or deleting rows.

Non-blocking observations:

- `scripts\Invoke-NinjaTraderUiStackSetup.ps1` keeps the LFE retry bounded to one retry and throws fail-closed when the template window remains missing.
- `src\Vincere.Operator\NinjaTraderUiDiscovery.cs` snapshot reads are read-only and block Add All when counts or enabled-state are uncertain, but they are still unproven against a supervised visible NinjaTrader desktop.

## 2026-06-07 Static Review Blocker Repair

Scope: repaired only the blocker noted in the static review above. No RDP, browser, NinjaTrader UI automation, live Add All, strategy enable/disable, scheduled-task change, deploy, GitHub push, secrets, production-impacting action, or automatic strategy-row deletion/cleanup was performed.

Changed:

- `src\Vincere.Operator\MainWindow.xaml.cs`: post-attempt unsafe or uncertain grid state now makes the account attempt user-visible as `FAIL`, preserves the original apply result in `source_apply_ok`, writes the fail-closed message into the audit row, and stops further Add All attempts with `if (!attemptOk) break;`.
- The repair keeps audit fields and row-delta detection intact. It does not enable/disable strategies and does not delete or clean up rows.

Validation run:

```powershell
git status --short --branch
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null; Write-Output "PARSER_OK"
rg -n "attemptOk|source_apply_ok|fail-closed after post-grid safety check|postGridUnsafe|if \(!attemptOk\)" src\Vincere.Operator\MainWindow.xaml.cs
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
git diff --check
rg -n "READY_ALGOS_ENABLE_STRATEGIES=false" .env.example README.md AGENT_HANDOFF.md docs
```

Results:

- PowerShell parser check passed with `PARSER_OK`.
- Static source search confirmed `attemptOk`, `source_apply_ok`, fail-closed post-grid message, and `if (!attemptOk)` stop condition.
- Release build passed with `0 Warning(s), 0 Error(s)`.
- `git diff --check` reported only Git line-ending warnings (`LF will be replaced by CRLF`), with no whitespace errors.
- `READY_ALGOS_ENABLE_STRATEGIES=false` remains present in `.env.example`, handoff, and docs.

Residual risks:

- This repair is still static/build validated only. It has not been proven against a visible NinjaTrader desktop.
- The grid snapshot uses read-only UI Automation tab selection and must be validated under supervised RDP before any client-readiness Add All retest.
- Safe readiness harness was not run in this cycle because the user prohibited RDP/browser/NinjaTrader UI actions.

Next approval gates:

- Kush must separately approve running the safe readiness harness from a visible/unlocked desktop, without `-IncludeLiveAddAll`.
- Kush must separately approve any supervised Add All retest, including exact RDP window, target account set, acceptable baseline `StrategiesGrid`, and pre-test `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, and all visible strategy rows disabled.
- Separate later approval is still required for any automatic partial-row deletion/cleanup, any live enable-path test, or changing `READY_ALGOS_ENABLE_STRATEGIES=true`.

## 2026-06-07 War Machine Static Review

Scope: read-only/static review of the current uncommitted Add All safety patch after Iron Man's fail-closed repair. Inspected only `AGENT_HANDOFF.md`, `scripts\Invoke-NinjaTraderUiStackSetup.ps1`, `src\Vincere.Operator\MainWindow.xaml.cs`, `src\Vincere.Operator\NinjaTraderUiDiscovery.cs`, and Add All diagnostic docs. No RDP, browser, NinjaTrader UI automation, live Add All, strategy enable/disable, scheduled-task change, cleanup/deletion, deployment, GitHub push, secrets, or production behavior change was performed.

Findings:

- Post-attempt unsafe or uncertain grid state now fails visibly: `attemptOk = ok && !postGridUnsafe`, the result line prints `FAIL`, and the audit preserves `source_apply_ok` separately from fail-closed `ok`.
- Post-attempt unsafe or uncertain grid state now stops further account attempts through `if (!attemptOk) break;`.
- Audit evidence is preserved with `pre_grid_state`, `post_grid_state`, `partial_rows_left`, `manual_cleanup_required`, `fail_closed_reasons`, `diagnostic_paths`, `diagnostic_run_id`, `diagnostic_root`, and `safety_completion`.
- The Add All diagnostic patch does not add strategy enable/disable or row deletion. Existing strategy-toggle and stack-row delete code remains elsewhere in the app, but the reviewed Add All safety path uses read-only grid snapshots and audit/fail-closed markers.
- LFE template load remains bounded to exactly one fail-closed retry and throws with diagnostics if the window still does not appear.

Validation:

```powershell
git status --short --branch
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null; Write-Output "PARSER_OK"
rg -n "attemptOk|source_apply_ok|fail-closed after post-grid safety check|postGridUnsafe|if \(!attemptOk\)|toggle\.Toggle\(|Remove|Delete|SetAllStrategiesEnabledAsync" scripts\Invoke-NinjaTraderUiStackSetup.ps1 src\Vincere.Operator\MainWindow.xaml.cs src\Vincere.Operator\NinjaTraderUiDiscovery.cs
git diff --check
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

Results:

- PowerShell parser check passed with `PARSER_OK`.
- Static search confirmed `attemptOk`, `source_apply_ok`, fail-closed post-grid message, and `if (!attemptOk)` stop condition.
- Static search found existing `SetAllStrategiesEnabledAsync`, `toggle.Toggle()`, and row delete/remove code outside this Add All diagnostic path; no new Add All cleanup/deletion behavior was identified.
- `git diff --check` reported only Git line-ending warnings and no whitespace errors.
- Release build passed with `0 Warning(s), 0 Error(s)`.

Residual risks:

- This is still static/build validation only. The patch has not been proven against a visible NinjaTrader desktop or live Strategy dialog.
- The read-only grid snapshot uses UI Automation tab selection, so it must be validated under supervised RDP before any client Add All readiness claim.
- Diagnostic paths and batch audit shape need confirmation from a supervised non-live-harness run before any Add All retest.

Next approval gate:

- Kush must separately approve running the safe readiness harness from a visible/unlocked desktop, without `-IncludeLiveAddAll`.
- Kush must separately approve any supervised Add All retest, including exact RDP window, target account set, acceptable baseline `StrategiesGrid`, and pre-test `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, and all visible strategy rows disabled.
- Separate later approval is still required for any automatic partial-row deletion/cleanup, live enable-path test, or changing `READY_ALGOS_ENABLE_STRATEGIES=true`.

## 2026-06-07 Next Approval-Ready Readiness Gate

Checked this cycle:

- Read `AGENT_HANDOFF.md`, current `git status --short --branch`, and the current Add All diagnostic docs under `docs\`.
- No RDP, browser, NinjaTrader UI automation, live Add All, strategy enable/disable, row deletion/cleanup, scheduled-task change, secret/network use, deploy, GitHub push, source edit, or production behavior change was performed.

Next gate for Kush approval:

```powershell
.\scripts\Test-VincereProductionReadiness.ps1
```

This is the non-live safe readiness harness only. It must be run from a visible/unlocked desktop only after Kush approves this exact command and checklist. Do not pass `-IncludeLiveAddAll`, do not run Add All, and do not use live enable/disable switches.

Required preconditions before the harness:

```text
READY_ALGOS_ENABLE_STRATEGIES=false
OrdersGrid=0
PositionsGrid=0
All visible strategy rows disabled
```

Stop before the harness if any order or position count is nonzero, any visible strategy row is enabled, any required grid/enabled-state read is uncertain, or the desktop is not visible/unlocked.

Checklist Kush must approve:

1. Confirm the preconditions above from the visible/unlocked desktop.
2. Run only `.\scripts\Test-VincereProductionReadiness.ps1`.
3. Do not run `-IncludeLiveAddAll` or any Add All path.
4. Preserve and review the readiness report before any supervised Add All retest approval.
5. Reconfirm after the harness that `OrdersGrid=0`, `PositionsGrid=0`, and all visible strategy rows are disabled.

Expected artifacts to preserve:

- `logs\production-readiness\<timestamp>\PRODUCTION_READINESS_REPORT.md`
- Any screenshots or UI evidence generated by the harness under the same readiness folder.
- Current `git status --short --branch` and relevant uncommitted diff summary.
- Any generated `logs\stack-apply-batches\*.json`, stack apply log, or Add All diagnostic path only if unexpectedly produced; the safe harness should not run Add All.

Explicitly forbidden for this gate:

- RDP/browser/NinjaTrader UI automation outside the approved visible-desktop readiness harness.
- Live Add All, `-IncludeLiveAddAll`, strategy enable/disable, or changing `READY_ALGOS_ENABLE_STRATEGIES=true`.
- Automatic strategy-row deletion/cleanup.
- Scheduled-task changes, deploys, GitHub push, secret/network use, or any production behavior change.

Exact approval question:

```text
Kush, do you approve running only the non-live safe readiness harness command .\scripts\Test-VincereProductionReadiness.ps1 from a visible/unlocked desktop, with READY_ALGOS_ENABLE_STRATEGIES=false, OrdersGrid=0, PositionsGrid=0, and all visible strategy rows disabled before and after, and with no -IncludeLiveAddAll, no Add All run, no live enable/disable, no row deletion/cleanup, no scheduled-task changes, no deploy, no push, no secrets/network use, and no production behavior changes?
```

## 2026-06-07 Cycle Note

Read `AGENT_HANDOFF.md`, `docs\VINCERE_ADD_ALL_DIAGNOSTIC_SOURCE_CHANGE_PLAN.md`, and ran `git status --short --branch`. Status before this handoff edit was clean on `vps-sync/20260607-vincere-diagnostic...origin/vps-sync/20260607-vincere-diagnostic`; after this cycle, only `AGENT_HANDOFF.md` is modified by this note.

The current non-live safe readiness harness approval question remains the correct next gate. No changed precondition was found. Required preconditions remain `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, all visible strategy rows disabled, and a visible/unlocked desktop for the approved harness only.

Exact blocker: the diagnostic Add All patch is still static/build validated only and not yet proven by the non-live safe readiness harness. Implementation remains blocked from any client Add All retest until Kush approves only `.\scripts\Test-VincereProductionReadiness.ps1` with no `-IncludeLiveAddAll`, no Add All run, no strategy enable/disable, no row deletion/cleanup, no scheduled-task changes, no deploy/push, no secrets/network use, and no production behavior changes.

## 2026-06-07 War Machine Gate Check

Read only `AGENT_HANDOFF.md` and ran `git status --short --branch`. Iron Man's current non-live readiness harness approval gate is complete and approval-ready: the exact command, preconditions, forbidden actions, artifacts to preserve, and approval question are already recorded above. No new diagnostic blocker was found before asking Kush. Current blocker remains Kush approval to run only `.\scripts\Test-VincereProductionReadiness.ps1` from a visible/unlocked desktop with `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, all visible strategy rows disabled, no `-IncludeLiveAddAll`, no Add All run, no live enable/disable, no row deletion/cleanup, and no production behavior change.

## 2026-06-07 Approval-Gated Deploy And Readiness

Kush approved Vincere readiness/RDP/Add All work, deploy/push, global Git safe-directory repair, scheduled-task changes, and real Telegram wrapper smoke testing.

Vincere actions completed:

- Confirmed branch `vps-sync/20260607-vincere-diagnostic` at commit `903097d` includes the diagnostic Add All source patch.
- Ran Release build:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

Result: build succeeded with `0 Warning(s), 0 Error(s)`.

- Deployed the current Release build to `C:\Users\Administrator\AppData\Local\Programs\VincereOps` with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Deploy-VincereOperatorInstalled.ps1
```

Deployment backup:

```text
C:\Users\Administrator\Documents\Projects\Vincere\Automation\backups\VincereOps-installed-20260607-180914
```

- Ran the safe post-deploy production readiness harness through the interactive one-shot scheduled task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-VincereProductionReadinessTask.ps1
```

Latest post-deploy readiness report:

```text
C:\Users\Administrator\Documents\Projects\Vincere\Automation\logs\production-readiness\20260607-180934\PRODUCTION_READINESS_REPORT.md
```

Summary: `PASS=40, FAIL=0, WARN=2, SKIP=10`.

Important readiness results:

- Vincere Operator attached and was responding as PID `7048`.
- Settings safety copy was present: strategy enable remains off until Add All is verified cleanly.
- NinjaTrader scan control invoked and reported discovered connection/account counts.
- Add All button was visible, but the harness did not pass `-IncludeLiveAddAll`, so Add All was intentionally skipped.
- Warning remains: `NinjaTrader process not found`, so no live Add All retest was run. Do not run Add All until NinjaTrader is running and the pre-test safety state is confirmed.

Current next gate:

Before any Add All click/run, confirm in the visible RDP desktop that NinjaTrader is running, `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, all visible strategy rows are disabled, and Kush has confirmed the exact target account set and baseline `StrategiesGrid`.

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
