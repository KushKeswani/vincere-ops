# Vincere Add All Diagnostic Gap Checklist

Date: 2026-06-06
Scope: read-only/static diagnostics for current Add All blockers. No RDP, browser GUI, credentials, secrets, Telegram, GitHub push, scheduled-task changes, live strategy enabling, NinjaTrader clicks, or production-impacting actions were performed.

## Current Blockers

- APEX instrument selector failure path: previous supervised Add All evidence showed repeated `instrument selector not found` failures for APEX accounts. Static review shows `scripts/Invoke-NinjaTraderUiStackSetup.ps1` now retries `InstrumentSelector`, scrolls/focuses the Properties panel, types the instrument root, prefers a visible `Futures` suggestion, and falls back to an explicit current contract. Gap: this is not yet proven against the live NinjaTrader dialog under supervised RDP.
- LFE template-load missing-window path: previous evidence showed `Template load window did not open` for the LFE account. Static review shows the script resolves a template path, opens the template slideout, invokes/clicks `load`, waits for a Load/Open/template picker window, then throws if no matching window appears. Gap: there is no alternate invocation retry or diagnostic tree capture for the missing-window case after the load action succeeds but no picker appears.
- Partial strategy-row rollback/cleanup proof: previous evidence showed Strategy rows increased after a failed Add All run, then were manually/supervised-cleaned to disabled state. Static review shows the script cancels the active Strategy dialog on exception, but confirmed rows from earlier successful dialog OK actions are not automatically removed, reconciled, or proven rolled back. Gap: no baseline row count, expected row-delta check, duplicate detection, or automatic removal/rollback proof exists for failed Add All batches.

## Static Checks Completed

- Read `AGENT_HANDOFF.md`.
- Checked repository status.
- Reviewed the instrument selector, template load, dialog cancel, and strategy loop paths in `scripts/Invoke-NinjaTraderUiStackSetup.ps1`.
- Confirmed target docs directory was absent before this checklist was added.
- Left `AGENT_HANDOFF.md` untouched.

## Diagnostic Evidence To Collect In Future Supervised RDP Test

- Pre-test effective safety config: record that `READY_ALGOS_ENABLE_STRATEGIES=false` in the effective Vincere Operator runtime settings.
- Pre-test NinjaTrader state: record exact `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, and whether all visible strategy rows are disabled. Stop if orders or positions are nonzero.
- Instrument selector path evidence: for the first APEX setup dialog, capture whether `InstrumentSelector` is found before scroll, after Properties-panel focus/scroll, after root typing, and whether the visible `Futures` suggestion appears and is selected.
- Template load path evidence: for the LFE setup dialog, capture the resolved template path, whether the template slideout appears, whether the `load` control is visible or invoked through UI Automation, and the top-level window names/classes visible during the missing-window wait period.
- Batch audit evidence: preserve the `logs/stack-apply-batches` JSON for the run and the corresponding stack apply log.
- Post-failure safety state: immediately record exact `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, and all visible strategy enabled/disabled states.
- Partial-row proof: compare post-test `StrategiesGrid` against baseline. If the count increased after failure, record which rows are new, disabled, duplicate, or manually reconciled. Do not schedule unattended readiness or live enable until rollback/cleanup is implemented or documented.
- Cleanup proof: after any supervised disable or manual reconciliation, re-record `OrdersGrid=0`, `PositionsGrid=0`, final `StrategiesGrid`, and all visible strategy rows disabled.

## Recommended Safe Next Diagnostics

1. Add non-invasive diagnostic logging around the instrument selector lookup stages before another supervised Add All test.
2. Add diagnostic tree/window capture for the LFE load-button-invoked-but-no-window case.
3. Design row-baseline and row-delta checks before adding any automatic cleanup behavior.
4. Keep live strategy enabling disabled until Add All completes cleanly and rollback/cleanup proof exists.
