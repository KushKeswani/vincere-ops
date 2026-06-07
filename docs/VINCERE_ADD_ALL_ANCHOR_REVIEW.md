# Vincere Add All Anchor Review

Date: 2026-06-06
Scope: diagnostic review of `docs/VINCERE_ADD_ALL_IMPLEMENTATION_ANCHORS.md` for a later Kush-approved diagnostic-only code slice. No source code was edited. No RDP, NinjaTrader clicks, strategy enabling, production behavior changes, GitHub push, secrets, or global Git config changes were performed.

## Verdict

- Overall: sufficient for a later diagnostic-only implementation slice.
- The anchors identify the correct primary files and functions for the three known Add All gaps: APEX instrument selector evidence, LFE template-load missing-window retry/diagnostics, and partial-row baseline/row-delta proof.
- The plan correctly keeps the first slice detection-only, preserves stop-on-first-failure behavior, keeps `READY_ALGOS_ENABLE_STRATEGIES=false`, and excludes automatic partial-row deletion.

## Anchor Sufficiency Findings

- APEX selector diagnostics: pass. Anchors point to `Find-InstrumentSelector`, `Set-Instrument`, `Find-InstrumentFuturesSuggestion`, `Try-ScrollIntoView`, and `Write-ElementDebugTree` in `scripts/Invoke-NinjaTraderUiStackSetup.ps1`. These are the right places to add staged breadcrumbs, selector failure snapshots, and stdout/stderr summaries captured by stack apply.
- LFE template-load diagnostics and retry: pass. Anchors point to `Load-Template`, `Show-TemplateSlideout`, `Find-VisibleDescendantByName`, `Invoke-OrClickElement`, `Write-ElementDebugTree`, and `Cancel-StrategiesDialog`. These cover the missing-window path and the one-retry fail-closed behavior.
- Partial-row baseline/row-delta proof: pass with implementation caution. Anchors point to Add All orchestration, batch audit writing, stack apply execution, and NinjaTrader UI discovery. This is enough to add per-attempt pre/post grid state and `partial_rows_left` audit fields, but the implementation must treat uncertain grid/checkbox reads as blocking rather than safe.

## Missing Or Weak Anchors To Add Before Code Work

- Define the diagnostic output root before implementation, such as `logs\add-all-diagnostics\<timestamp-or-batch-id>\`, and use the same run id in script diagnostics, stack apply output, and batch audit JSON.
- Anchor where the script receives or derives account/strategy attempt identity so diagnostic filenames can include account, strategy type, and attempt index without leaking secrets.
- Anchor the exact batch audit schema fields to add: `pre_grid_state`, `post_grid_state`, `enabled_state_uncertain`, `partial_rows_left`, `diagnostic_paths`, and `manual_cleanup_required`.
- Anchor the fail-closed semantics for uncertainty in one place: nonzero orders, nonzero positions, any enabled visible strategy row, uncertain enabled-state read, or uncertain grid count must prevent a safe completion mark.
- Anchor where readiness-harness assertions should be extended, if any, so the safe harness can verify new diagnostics/audit fields without running live Add All.
- Anchor log-size bounds for UI tree snapshots so diagnostics remain client-safe and do not dump excessive UI state.

## Exact Approval Gates

- Before code work: Kush approval to implement only the diagnostic Add All slice in the anchored files.
- Before code work: Kush confirmation that no automatic row deletion, strategy enabling, scheduled-task changes, or production behavior changes are allowed.
- Before code work: Kush confirmation that `READY_ALGOS_ENABLE_STRATEGIES=false` remains mandatory.
- Before supervised RDP retest: Kush approval of the exact retest time window and confirmation he can observe the active desktop.
- Before supervised RDP retest: Kush approval of the exact target account set and acceptable baseline `StrategiesGrid` rows.
- Immediately before Add All retest: Kush confirmation that `OrdersGrid=0`, `PositionsGrid=0`, all visible strategy rows are disabled, and `READY_ALGOS_ENABLE_STRATEGIES=false`.
- At retest moment: explicit Kush approval to click/run Add All after the pre-test state is recorded.
- Separate later approval required for any automatic partial-row deletion/cleanup.
- Separate later approval required for any live enable-path test or changing `READY_ALGOS_ENABLE_STRATEGIES=true`.

## Next Safe Diagnostic-Only Task

Create a small source-change plan or implementation patch for diagnostics only:

1. Add a shared per-run diagnostic id/path used by `Invoke-NinjaTraderUiStackSetup.ps1`, stack apply messages, and batch audit JSON.
2. Add APEX selector stage breadcrumbs and bounded UI tree snapshots on selector failure.
3. Add LFE template-load breadcrumbs, top-level window capture near timeout, and exactly one fail-closed retry.
4. Add read-only per-attempt grid-state capture and row-delta audit fields with no automatic deletion.
5. Run only parser/build/readiness checks after implementation, with live Add All excluded until Kush approves supervised RDP testing.
