# Vincere Add All Implementation Anchors

Date: 2026-06-06
Scope: documentation-only anchors for the smallest later diagnostic-only implementation slice. No code was edited in this cycle. No RDP, NinjaTrader clicks, strategy enabling, production behavior changes, GitHub push, secrets, or global Git config changes were performed.

## Non-Negotiable Scope

- Keep `READY_ALGOS_ENABLE_STRATEGIES=false`.
- Add diagnostics and fail-closed detection only.
- Do not add automatic strategy-row deletion in the first implementation slice.
- Do not run Add All, click NinjaTrader, or use RDP during implementation validation.
- Preserve existing batch stop-on-first-failure behavior.

## Slice 1: APEX Selector Diagnostics

Primary file:

- `scripts/Invoke-NinjaTraderUiStackSetup.ps1`

Exact anchors:

- `Find-InstrumentSelector` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:686`
- `Set-Instrument` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:726`
- `Find-InstrumentFuturesSuggestion` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:403`
- `Try-ScrollIntoView` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:759`
- `Write-ElementDebugTree` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:770`

Smallest later change:

1. Add per-run diagnostic context variables near the script setup so each account/strategy attempt can write to a deterministic local diagnostics folder.
2. In `Set-Instrument`, record these stages: initial selector search, selector after scroll/focus, textbox target used, root typed, Futures suggestion found/selected, fallback contract entered, and final failure.
3. In `Find-InstrumentSelector`, add optional diagnostic notes for whether lookup succeeded by automation id, Properties-panel focus/scroll, or fallback name/class scan.
4. On selector failure, call `Write-ElementDebugTree` for the Strategy dialog and, when found, the Properties subtree.
5. Add the diagnostic path and short stage summary to stdout/stderr so `StackApplyService` captures it in the account result.

Fail-closed rule:

- If selector lookup remains uncertain, throw. Do not confirm the Strategy dialog.

## Slice 2: LFE Template-Load Retry And Diagnostics

Primary file:

- `scripts/Invoke-NinjaTraderUiStackSetup.ps1`

Exact anchors:

- `Load-Template` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:890`
- `Show-TemplateSlideout` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:801`
- `Find-VisibleDescendantByName` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:46`
- `Invoke-OrClickElement` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:96`
- `Write-ElementDebugTree` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:770`
- `Cancel-StrategiesDialog` at `scripts/Invoke-NinjaTraderUiStackSetup.ps1:1065`

Smallest later change:

1. In `Load-Template`, log resolved template path, whether default-template fallback was used, slideout visibility, header visibility, load control visibility, and invocation method.
2. During the wait for the Load/Open/template picker window, capture top-level NinjaTrader window names, automation ids, classes, process ids, and bounds near timeout.
3. If the first load invocation produces no window, retry exactly once: refocus the Strategy dialog, reacquire/re-expand the template slideout, reacquire the `load` control, and invoke/click it again.
4. If the second attempt still produces no window, throw with the diagnostic path in the message.
5. Do not skip template loading, choose a different template, or proceed to OK when template loading is not proven.

Fail-closed rule:

- Missing template picker after the one retry must fail the account, cancel the active Strategy dialog, and stop the batch through existing Add All behavior.

## Slice 3: Row-Baseline / Row-Delta Audit Detection

Primary orchestration files:

- `src/Vincere.Operator/MainWindow.xaml.cs`
- `src/Vincere.Core/Services/StackApplyService.cs`
- `src/Vincere.Operator/NinjaTraderUiDiscovery.cs`

Exact anchors:

- `ApplyAllStacks_Click` at `src/Vincere.Operator/MainWindow.xaml.cs:1895`
- `GetStackAttachTargetsAsync` at `src/Vincere.Operator/MainWindow.xaml.cs:2024`
- `ApplyAttachTargetsAsync` at `src/Vincere.Operator/MainWindow.xaml.cs:2058`
- `WriteAttachBatchAuditAsync` at `src/Vincere.Operator/MainWindow.xaml.cs:2114`
- `AttachTarget` at `src/Vincere.Operator/MainWindow.xaml.cs:2162`
- `StackApplyService.ExecuteAsync` at `src/Vincere.Core/Services/StackApplyService.cs:42`
- `StackApplyService.AppendApplyLogAsync` at `src/Vincere.Core/Services/StackApplyService.cs:156`
- `StackApplyService.TryExecuteUiAutomationAsync` at `src/Vincere.Core/Services/StackApplyService.cs:184`
- `NinjaTraderStrategyToggleResult` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:10`
- `NinjaTraderUiDiscovery.SetAllStrategiesEnabledAsync` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:78`
- `NinjaTraderUiDiscovery.SetAllStrategiesEnabled` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:114`
- `NinjaTraderUiDiscovery.FindControlCenter` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:386`
- `NinjaTraderUiDiscovery.TrySelectTab` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:451`
- `NinjaTraderUiDiscovery.IsVisibleEnabled` at `src/Vincere.Operator/NinjaTraderUiDiscovery.cs:513`

Existing script references for manual/supervised evidence:

- `scripts/Probe-NinjaTraderGridCounts.ps1`, grid count collection around `OrdersGrid`, `PositionsGrid`, and `StrategiesGrid`.
- `scripts\Test-VincereProductionReadiness.ps1:564`, existing Strategies grid discovery in the safe harness.

Smallest later change:

1. Add a read-only grid-state capture helper, preferably in `NinjaTraderUiDiscovery`, that returns `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, visible enabled checkbox count, visible disabled checkbox count, and an uncertainty flag.
2. Call the helper from `ApplyAttachTargetsAsync` before each account attempt and after each account attempt.
3. Fail closed before the first account attempt if orders or positions are nonzero, any visible strategy row is enabled, or enabled-state detection is uncertain.
4. On failure after an account attempt, compare post-attempt `StrategiesGrid` to the pre-attempt baseline. If it increased, mark `partial_rows_left=true`.
5. Extend the batch audit payload in `WriteAttachBatchAuditAsync` to include pre/post grid state per attempted account, `partial_rows_left`, and the required manual cleanup checklist.
6. Keep the first pass detection-only. Do not remove rows automatically.

Fail-closed rule:

- Any uncertain grid count or enabled-state read must block the batch from being marked safe.

## Required Local Checks Before Any Supervised Retest

Run these only after Kush approves code implementation of this diagnostic-only slice.

PowerShell parser check:

```powershell
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null
```

Target operator build:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

Safe readiness harness, with live Add All excluded:

```powershell
.\scripts\Test-VincereProductionReadiness.ps1
```

Evidence review before retest:

- Review `logs\stack-apply-batches\*.json`.
- Review `stack-apply.log`.
- Review new diagnostic snapshot paths.
- Review the readiness report.
- Stop if parser, build, readiness, or evidence review fails.

## Exact Kush Approvals Needed

Before code implementation:

- Kush approval to implement diagnostic-only Add All changes in the anchored files above.
- Kush confirmation that the implementation must remain detection-only for partial rows, with no automatic deletion.
- Kush confirmation that `READY_ALGOS_ENABLE_STRATEGIES=false` remains mandatory.

Before supervised Add All retest:

- Kush approval of the exact RDP retest window and confirmation that Kush can observe the active desktop.
- Kush approval of the exact target account set.
- Kush approval of the acceptable baseline `StrategiesGrid` rows before Add All.
- Kush confirmation immediately before retest that `OrdersGrid=0`, `PositionsGrid=0`, all visible strategy rows are disabled, and `READY_ALGOS_ENABLE_STRATEGIES=false`.
- Explicit Kush approval to click/run Add All during that supervised RDP session after the pre-test state is recorded.

Separate later approvals:

- Approval before designing or testing automatic partial-row deletion or cleanup.
- Approval before any live enable-path test.
- Approval before changing `READY_ALGOS_ENABLE_STRATEGIES=true`.
