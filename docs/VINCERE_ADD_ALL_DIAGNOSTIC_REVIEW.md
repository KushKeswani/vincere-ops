# Vincere Add All Diagnostic Review

Date: 2026-06-06
Scope: read-only diagnostic review of `AGENT_HANDOFF.md`, `docs/VINCERE_ADD_ALL_DIAGNOSTIC_GAP_CHECKLIST.md`, and `docs/VINCERE_ADD_ALL_REPAIR_PLAN.md`. No RDP, NinjaTrader clicks, strategy enabling, production behavior changes, GitHub push, secrets, or global Git config changes were performed.

## Review Verdict

- Overall: pass at plan level. `docs/VINCERE_ADD_ALL_REPAIR_PLAN.md` covers the three known Add All gaps and keeps the next work production-aware by limiting the first implementation slice to diagnostics, fail-closed checks, and row-delta proof.
- Remaining risk: the plan is not behavioral proof. APEX selector handling, LFE template-load retry behavior, and row-baseline/row-delta detection still need implementation, parser/build/readiness validation, and then supervised RDP evidence before Add All can be considered ready.

## Gap Coverage Findings

- APEX instrument selector evidence: pass. The repair plan explicitly calls for breadcrumbs around `Find-InstrumentSelector` and `Set-Instrument`, staged selector state logging, bounded UI tree snapshots on failure, and audit details for account, strategy type, requested/resolved instrument, root, and fallback contract. Gap to close during implementation: ensure diagnostics are written to a per-run local log/audit path and are included in the operator-visible failure result without requiring secrets or live UI changes.
- LFE template-load missing-window retry/diagnostics: pass. The repair plan includes resolved-template diagnostics, slideout/header/load-control state, invocation method, visible top-level window capture during the wait, and one conservative retry after the first no-window result. Gap to close during implementation: the retry must remain fail-closed, attempt at most once, and must not skip template loading, auto-pick a different template, or confirm the Strategy dialog when the template window remains unproven.
- Partial-row baseline/row-delta proof: pass. The repair plan requires pre/post `OrdersGrid`, `PositionsGrid`, `StrategiesGrid`, enabled-state summary, nonzero orders/positions fail-closed behavior, enabled-row fail-closed behavior, `partial_rows_left=true` audit marking, and no automatic deletion in the first pass. Gap to close during implementation: row baseline collection must be read-only and resilient if NinjaTrader grids are visible but partially virtualized; any uncertain enabled-state read should fail closed rather than mark the batch safe.

## Safest Next Implementation Slice

1. Add diagnostic-only logging for APEX selector stages and LFE template-load stages in `scripts/Invoke-NinjaTraderUiStackSetup.ps1`.
2. Add one bounded LFE load retry after a no-window result, with diagnostic capture before final failure.
3. Add row-baseline and row-delta detection/audit fields around Add All account attempts, with no automatic row deletion.
4. Preserve current safety behavior: stop on first failed account, cancel the active Strategy dialog on exceptions, leave `READY_ALGOS_ENABLE_STRATEGIES=false`, and never enable strategies as part of repair validation.

## Required Checks Before Supervised Retest

- PowerShell parser check:

```powershell
$script = Get-Content -Raw scripts\Invoke-NinjaTraderUiStackSetup.ps1; [scriptblock]::Create($script) | Out-Null
```

- Target operator build:

```powershell
dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore -v minimal
```

- Safe readiness harness only, with live Add All excluded:

```powershell
.\scripts\Test-VincereProductionReadiness.ps1
```

- Review generated evidence paths before any retest: stack-apply logs, `logs\stack-apply-batches\*.json`, new diagnostic snapshots, and readiness report. Do not proceed if parser/build/readiness checks fail.

## Exact Kush Approvals Needed

- Approval to implement diagnostic-only Add All repair changes, including APEX selector diagnostics, LFE load retry/diagnostics, and row-baseline/row-delta detection with no automatic deletion.
- Approval of the exact supervised RDP retest window and confirmation that Kush can observe the active desktop.
- Approval of the exact target account set for the retest and the acceptable baseline `StrategiesGrid` rows before Add All.
- Confirmation immediately before retest that `READY_ALGOS_ENABLE_STRATEGIES=false`, `OrdersGrid=0`, `PositionsGrid=0`, and all visible strategy rows are disabled.
- Explicit approval to click/run Add All during the supervised RDP session after the pre-test safety state is recorded.
- Separate later approval before any automatic partial-row deletion/cleanup behavior is designed or tested.
- Separate later approval before any live enable-path test or any change to `READY_ALGOS_ENABLE_STRATEGIES=true`.
