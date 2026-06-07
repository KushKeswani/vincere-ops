# Vincere Add All Repair Plan

Date: 2026-06-06
Scope: smallest implementation plan to move Add All toward safe production readiness without touching live NinjaTrader. This plan is documentation-only for this cycle; no RDP, NinjaTrader clicks, strategy enabling, production behavior changes, GitHub push, external messaging, or code edits were performed.

## Safety Invariants

- Keep `READY_ALGOS_ENABLE_STRATEGIES=false` until Add All completes cleanly and Kush explicitly approves a supervised live enable-path test.
- Do not run Add All from headless SSH.
- Do not schedule unattended readiness or live enable while row-baseline/rollback proof is missing.
- Every future UI test must record `OrdersGrid=0`, `PositionsGrid=0`, `StrategiesGrid=<count>`, and all visible strategy rows disabled before and after the test.

## Gap 1: APEX Instrument Selector Diagnostics

Problem: previous supervised Add All evidence showed repeated APEX failures with `instrument selector not found`. Static review shows the script already retries `InstrumentSelector`, scrolls/focuses the Properties panel, types the root, prefers a visible `Futures` suggestion, and falls back to an explicit current contract, but this is not proven against the live NT8 dialog.

Smallest implementation plan:

1. Add diagnostic breadcrumbs inside `scripts/Invoke-NinjaTraderUiStackSetup.ps1` around `Find-InstrumentSelector` and `Set-Instrument`.
2. Log whether the selector was found at each stage: initial search, after Properties focus, after scroll, after root typing, and after fallback contract entry.
3. When selector lookup fails, write a bounded UI tree snapshot for the Strategy dialog and Properties panel to a per-run diagnostic folder under local app logs.
4. Include account, strategy type, requested instrument, resolved instrument, instrument root, and current-contract fallback in the existing stack apply message/audit output.
5. Validate with a parser check first; only then run a supervised RDP what-if or controlled Add All test with Kush present.

Acceptance proof:

- For first APEX account, diagnostics show exactly which selector stage passed or failed.
- If the selector is found, diagnostics show whether `Futures` suggestion selection or current-contract fallback was used.
- If it fails, the diagnostic tree is sufficient to adjust lookup without another blind run.

## Gap 2: LFE Template-Load Missing-Window Diagnostics And Retry Options

Problem: previous supervised evidence showed `Template load window did not open` for LFE. Static review shows the script resolves a template path, opens the template slideout, invokes/clicks `load`, waits for a Load/Open/template picker window, then throws. There is no alternate retry after the load action appears to succeed but no window is detected.

Smallest implementation plan:

1. Add diagnostics around `Load-Template`: resolved template path, default-template fallback decision, slideout found state, header found state, load control found state, invocation method, and wait deadline.
2. During the missing-window wait, capture visible NinjaTrader/top-level window names, automation ids, class names, process ids, and bounds at least once near timeout.
3. Add one conservative retry option only after the first load invocation produces no window: refocus the Strategy dialog, reopen or re-expand the template slideout, reacquire the `load` control, and invoke/click it once more.
4. If the second attempt still produces no window, fail closed with the captured diagnostic path in the returned error message.
5. Do not auto-pick a different template or skip template loading unless Kush explicitly approves that behavior later.

Acceptance proof:

- LFE failure report states whether the template path existed, whether the load control was visible/invoked, and what windows were visible while waiting.
- Retry is attempted at most once and does not confirm the Strategy dialog if template loading remains unproven.
- Failure remains safe: active dialog is cancelled, batch stops on the failed account, and no strategies are enabled.

## Gap 3: Row-Baseline / Row-Delta Cleanup Proof

Problem: previous failed Add All increased the Strategies grid from 4 to 7. Current code cancels the active dialog on exception, but confirmed rows from earlier successful OK actions are not automatically removed, reconciled, or proven rolled back.

Smallest implementation plan:

1. Add read-only row baseline capture before each account attempt: `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, and visible strategy enabled-state count.
2. Fail closed before Add All if `OrdersGrid` or `PositionsGrid` is nonzero, or if any visible strategy row is enabled.
3. After each account attempt, capture the same grid counts and enabled-state count.
4. Compare expected row delta with attempted row count. If an account fails and `StrategiesGrid` increased, mark the batch as `partial_rows_left=true`, include baseline/post counts in the audit, and block any further account attempts.
5. For the first repair pass, do not implement automatic row deletion. Prove detection first. Automatic cleanup should be a separate supervised design because deleting NinjaTrader strategy rows is production-impacting and UI-version-sensitive.
6. Add a supervised cleanup checklist entry to the batch failure message: disable all visible strategy rows, manually reconcile/remove partial rows if needed, then re-record final counts.

Acceptance proof:

- Every Add All batch audit records pre/post `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, and visible enabled-state summary.
- A failed batch with increased strategy count is explicitly flagged as partial and cannot be mistaken for safe completion.
- Cleanup proof is documented before any future unattended readiness or live enable-path test.

## Smallest Safe Work Order

1. Implement diagnostics only for APEX selector and LFE template load.
2. Implement row-baseline and row-delta detection only; no automatic deletion yet.
3. Run local parser/build checks.
4. Re-run the safe readiness harness without `-IncludeLiveAddAll`.
5. Prepare a supervised RDP test packet for Kush with exact pre/post safety checklist.
6. Run supervised Add All only after Kush confirms timing, screen access, target accounts, and that no orders/positions are open.

## Kush Blockers

- Kush must provide/confirm an active RDP session for any real NT8 UI proof.
- Kush must explicitly approve the first supervised Add All retest after diagnostics are implemented.
- Kush must confirm the intended client account set and acceptable baseline strategy rows before any Add All test.
- Kush must confirm no open orders/positions and that all visible strategy rows are disabled before the test starts.
- Kush must decide later whether automatic partial-row deletion is allowed; until then, implement detection and manual cleanup proof only.
