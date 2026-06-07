# Vincere Add All Diagnostic Source Change Plan

Date: 2026-06-06
Scope: documentation-only source-change plan for a later Kush-approved diagnostic Add All slice. No source code was edited in this cycle. No RDP, NinjaTrader clicks, strategy enabling, production behavior changes, GitHub push, secrets, or global Git config changes were performed.

## Intent

Make the next code slice small, diagnostic-only, and fail-closed:

- Add APEX instrument selector diagnostics.
- Add one fail-closed LFE template-load retry with diagnostics.
- Add row-baseline / row-delta audit detection.
- Do not add automatic strategy-row deletion.
- Keep `READY_ALGOS_ENABLE_STRATEGIES=false`.

## Shared Diagnostic Run Identity

Add one shared diagnostic id/path and carry it through script output and batch audit.

Proposed root:

```text
<Vincere data directory>\logs\add-all-diagnostics\<batchId>\
```

When only the PowerShell script has context, use:

```text
<TEMP>\vincere-add-all-diagnostics\<yyyyMMdd-HHmmss>-<shortGuid>\
```

Required identity fields:

- `batch_id`
- `diagnostic_run_id`
- `diagnostic_root`
- `account_id`
- `account_display_name`
- `strategy_type`
- `strategy_index`
- `attempt_index`
- `phase`

Filename pattern:

```text
<attempt_index>-<account>-<strategy_type>-<phase>.txt
```

Keep filenames normalized to alphanumeric, dash, and underscore.

## Source Changes: APEX Selector Diagnostics

Primary file:

- `scripts/Invoke-NinjaTraderUiStackSetup.ps1`

Functions to change:

- `Find-InstrumentSelector` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:686`
- `Set-Instrument` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:726`
- `Find-InstrumentFuturesSuggestion` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:403`
- `Try-ScrollIntoView` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:759`
- `Write-ElementDebugTree` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:770`

Minimal changes:

1. Add a bounded diagnostics writer near the top of the script:
   - `Add-DiagnosticEvent`
   - `New-DiagnosticPath`
   - `Normalize-DiagnosticName`
2. Create diagnostic context in the per-strategy loop before `Select-AvailableStrategy`.
3. In `Find-InstrumentSelector`, record:
   - `selector_initial_by_automation_id`
   - `properties_panel_visible`
   - `properties_panel_focused`
   - `selector_after_properties_focus`
   - `selector_by_name_or_class_fallback`
4. In `Set-Instrument`, record:
   - `requested_instrument`
   - `resolved_instrument`
   - `instrument_root`
   - `selector_found_before_scroll`
   - `selector_found_after_scroll`
   - `selector_textbox_found`
   - `root_typed`
   - `futures_suggestion_found`
   - `futures_suggestion_selected`
   - `fallback_contract`
   - `fallback_contract_entered`
5. On selector failure, write bounded UI tree snapshots:
   - Strategy dialog snapshot.
   - Properties subtree snapshot when available.
6. Emit a concise diagnostic summary to stdout so `StackApplyService` includes it in the account result.

Snapshot bounds:

- Maximum depth: `6` unless explicitly raised for a single failure.
- Maximum files per strategy attempt: `4`.
- Maximum diagnostic line length: `500` characters.
- Do not dump secrets or environment variables.

Fail-closed behavior:

- If selector state is uncertain or missing, throw and cancel the active Strategy dialog through existing exception handling.
- Do not proceed to `Confirm-StrategiesDialog`.

## Source Changes: LFE Template-Load Retry And Diagnostics

Primary file:

- `scripts/Invoke-NinjaTraderUiStackSetup.ps1`

Functions to change:

- `Load-Template` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:890`
- `Show-TemplateSlideout` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:801`
- `Find-VisibleDescendantByName` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:46`
- `Invoke-OrClickElement` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:96`
- `Write-ElementDebugTree` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:770`
- `Cancel-StrategiesDialog` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:1065`

Minimal changes:

1. In `Load-Template`, record:
   - `requested_template_name`
   - `resolved_template_path`
   - `used_default_template`
   - `template_path_exists`
   - `slideout_found`
   - `slideout_visible`
   - `template_header_found`
   - `load_control_found`
   - `load_control_visible`
   - `load_invocation_method`
   - `template_window_wait_started`
   - `template_window_found`
2. Add a bounded top-level window capture helper:
   - capture NinjaTrader and immediate desktop modal windows only.
   - fields: `name`, `automation_id`, `class_name`, `process_id`, `control_type`, `bounds`.
3. On first missing-window result:
   - capture top-level window snapshot.
   - refocus Strategy dialog.
   - call `Show-TemplateSlideout` again.
   - reacquire `load`.
   - invoke/click `load` exactly one more time.
4. On second missing-window result:
   - write final top-level window snapshot.
   - throw with diagnostic path in the error message.

Fail-closed behavior:

- Retry at most once.
- Do not skip template loading.
- Do not select a different template automatically.
- Do not confirm the Strategy dialog when the template picker/window remains unproven.

## Source Changes: Row-Baseline / Row-Delta Audit Detection

Primary files:

- `src/Vincere.Operator/NinjaTraderUiDiscovery.cs`
- `src/Vincere.Operator/MainWindow.xaml.cs`
- `src/Vincere.Core/Services/StackApplyService.cs`

Functions/classes to change:

- `NinjaTraderUiDiscovery.FindControlCenter` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:386`
- `NinjaTraderUiDiscovery.TrySelectTab` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:451`
- `NinjaTraderUiDiscovery.IsVisibleEnabled` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:513`
- `NinjaTraderUiDiscovery.SetAllStrategiesEnabled` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:114` as a reference for visible checkbox reading; do not enable or disable strategies for this slice.
- `ApplyAttachTargetsAsync` at `src/Vincere.Operator/MainWindow.xaml.cs:2058`
- `WriteAttachBatchAuditAsync` at `src/Vincere.Operator/MainWindow.xaml.cs:2114`
- `AttachTarget` at `src/Vincere.Operator/MainWindow.xaml.cs:2162`
- `StackApplyService.ExecuteAsync` at `src/Vincere.Core/Services/StackApplyService.cs:42`
- `StackApplyService.AppendApplyLogAsync` at `src/Vincere.Core/Services/StackApplyService.cs:156`
- `StackApplyService.TryExecuteUiAutomationAsync` at `src/Vincere.Core/Services/StackApplyService.cs:184`

Minimal changes:

1. Add a read-only result type in `NinjaTraderUiDiscovery.cs`, for example:
   - `NinjaTraderGridSafetySnapshot`
2. Add a read-only method in `NinjaTraderUiDiscovery.cs`, for example:
   - `GetGridSafetySnapshotAsync(TimeSpan? timeout = null)`
3. Snapshot method must read only:
   - `OrdersGrid`
   - `PositionsGrid`
   - `StrategiesGrid`
   - visible strategy enabled checkbox count
   - visible strategy disabled checkbox count
   - uncertain/failed read reasons
4. In `ApplyAttachTargetsAsync`:
   - capture `pre_grid_state` before each target.
   - fail closed before executing target if pre-state has nonzero orders, nonzero positions, enabled strategy rows, or uncertainty.
   - capture `post_grid_state` after each target.
   - if account fails and strategy count increased, set `partial_rows_left=true`.
   - keep stop-on-first-failure.
5. In `WriteAttachBatchAuditAsync`, include per-account grid state and diagnostic paths in the batch JSON.
6. In `StackApplyService`, carry diagnostic path summaries returned by the PowerShell script into `AppendApplyLogAsync` and the caller-visible message. Avoid changing execution semantics.

Fail-closed behavior:

- Any uncertain order count blocks safe completion.
- Any uncertain position count blocks safe completion.
- Any uncertain enabled-state read blocks safe completion.
- Any visible enabled strategy row blocks Add All start.
- Any failed account with increased `StrategiesGrid` is marked partial and manual cleanup required.
- No automatic row deletion in this slice.

## Proposed Batch Audit Schema

Extend the existing `logs\stack-apply-batches\stack-apply-batch-<batchId>.json` payload.

Top-level additions:

```json
{
  "schema_version": 2,
  "diagnostic_run_id": "20260606-123456-ab12cd",
  "diagnostic_root": "C:\\Users\\...\\logs\\add-all-diagnostics\\20260606-123456",
  "ready_algos_enable_strategies_required_false": true,
  "manual_cleanup_required": false,
  "partial_rows_left": false,
  "safety_completion": "passed|failed|blocked|uncertain"
}
```

Per-attempt result additions:

```json
{
  "attempt_index": 1,
  "target_account_id": "guid",
  "target_display_name": "APEX...",
  "row_count_requested": 2,
  "ok": false,
  "message": "instrument selector not found; diagnostics: ...",
  "pre_grid_state": {
    "orders_grid_count": 0,
    "positions_grid_count": 0,
    "strategies_grid_count": 4,
    "visible_strategy_enabled_count": 0,
    "visible_strategy_disabled_count": 4,
    "enabled_state_uncertain": false,
    "grid_count_uncertain": false,
    "read_error": ""
  },
  "post_grid_state": {
    "orders_grid_count": 0,
    "positions_grid_count": 0,
    "strategies_grid_count": 5,
    "visible_strategy_enabled_count": 0,
    "visible_strategy_disabled_count": 5,
    "enabled_state_uncertain": false,
    "grid_count_uncertain": false,
    "read_error": ""
  },
  "expected_strategy_row_delta": 2,
  "actual_strategy_row_delta": 1,
  "partial_rows_left": true,
  "manual_cleanup_required": true,
  "diagnostic_paths": [
    "C:\\Users\\...\\logs\\add-all-diagnostics\\...\\selector-dialog.txt"
  ],
  "fail_closed_reasons": [
    "account_failed",
    "strategy_count_increased_after_failure"
  ],
  "completed_at": "2026-06-06T00:00:00-04:00"
}
```

Allowed `safety_completion` values:

- `passed`: all attempted accounts succeeded, no unsafe grid state, no uncertainty.
- `failed`: at least one account failed but post-state was readable.
- `blocked`: pre-state prevented Add All from starting.
- `uncertain`: any required grid or enabled-state read was uncertain.

## Validation Commands After Later Code Implementation

Run only after Kush approves source implementation.

PowerShell parser check:

```powershell
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null
```

Target operator build:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

Safe readiness harness with live Add All excluded:

```powershell
.\scripts\Test-VincereProductionReadiness.ps1
```

Optional static searches before review:

```powershell
rg -n "partial_rows_left|diagnostic_run_id|pre_grid_state|post_grid_state|manual_cleanup_required" src scripts
rg -n "READY_ALGOS_ENABLE_STRATEGIES=false" .env.example README.md AGENT_HANDOFF.md docs
```

Do not run:

- `-IncludeLiveAddAll`
- live enable/disable switches
- RDP automation
- NinjaTrader clicks
- scheduled-task changes
- GitHub push

## Approval Gates

Before code implementation:

- Kush approves implementation of this diagnostic-only source slice.
- Kush confirms no automatic row deletion.
- Kush confirms no strategy enabling.
- Kush confirms no production behavior changes beyond diagnostics and fail-closed blocking.
- Kush confirms `READY_ALGOS_ENABLE_STRATEGIES=false` remains mandatory.

Before supervised Add All retest:

- Parser check passes.
- Release build passes.
- Safe readiness harness passes with live Add All excluded.
- New batch audit schema is reviewed.
- New diagnostic output path is reviewed.
- Kush approves exact RDP retest window.
- Kush confirms he can observe the active desktop.
- Kush approves target account set and acceptable baseline `StrategiesGrid`.
- Immediately before retest, Kush confirms:

```text
READY_ALGOS_ENABLE_STRATEGIES=false
OrdersGrid=0
PositionsGrid=0
All visible strategy rows disabled
```

- Kush gives explicit approval to click/run Add All only after pre-test state is recorded.

Separate later approvals:

- Any automatic partial-row deletion/cleanup.
- Any live enable-path test.
- Any change to `READY_ALGOS_ENABLE_STRATEGIES=true`.
