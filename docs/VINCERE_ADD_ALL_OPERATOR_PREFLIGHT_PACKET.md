# Vincere Add All Operator Preflight Packet

Use this packet during the next Kush-approved supervised visible/unlocked RDP preflight only.

This packet does not approve Add All. Do not click or run Add All until the preflight evidence is complete and Kush separately approves the exact Add All run.

## Current Gate

- Approved now: supervised visible/unlocked RDP preflight only.
- Still unapproved: Add All click/run, strategy enable/disable, row cleanup/deletion, scheduled-task changes, deploys, pushes, secrets/network calls, Telegram/external messages, and production behavior changes.
- Required safety setting: `READY_ALGOS_ENABLE_STRATEGIES=false`.
- Evidence template to fill: `docs\VINCERE_ADD_ALL_RDP_PREFLIGHT_EVIDENCE_TEMPLATE.md`.

## 2026-06-09 Operator-Ready Blocker Summary

Current blocker: the last supervised Add All attempt failed closed after `1/6` accounts because requested base strategy `DJDR` selected `DJDR-PF-1.1`. The patch note in `AGENT_HANDOFF.md` says selector matching has been corrected and statically checked, but no new supervised UI safety recheck or Add All retry is approved by this packet.

Evidence still required before any Add All UI action:

```text
READY_ALGOS_ENABLE_STRATEGIES=false
Desktop visible/unlocked=yes
NinjaTrader running=yes
Control Center visible/unlocked=yes
Failure popup/modal state resolved or explicitly documented
OrdersGrid=0
PositionsGrid=0
All visible strategy rows disabled=yes
Target account set=<exact Kush-approved accounts>
StrategiesGrid=<baseline count>
No stale/leftover strategy rows beyond approved baseline=yes
git status --short --branch before=<recorded>
git status --short --branch after=<recorded>
Evidence location or screenshot references=<paths>
```

Exact approval question for the next visible/unlocked RDP preflight only:

```text
Kush, do you approve a supervised visible/unlocked RDP preflight only, with no Add All click/run, to verify READY_ALGOS_ENABLE_STRATEGIES=false, NinjaTrader Control Center visible, failure popup/modal state resolved or documented, OrdersGrid=0, PositionsGrid=0, all visible strategy rows disabled, exact target account set, baseline StrategiesGrid, and no stale/leftover rows beyond the approved baseline?
```

Single next operator action: after Kush answers yes to the preflight-only question, perform only that visible/unlocked RDP safety recheck and record the evidence. Do not request or perform Add All until every field above is clean and Kush separately approves the exact Add All retry.

## Fields To Fill

Record exact values before asking for any Add All approval:

```text
Date=
Operator=
Kush approval reference=
git status --short --branch before=
READY_ALGOS_ENABLE_STRATEGIES=false
Desktop visible/unlocked=<yes/no>
NinjaTrader running=<yes/no>
OrdersGrid=0
PositionsGrid=0
All visible strategy rows disabled=<yes/no>
Target account set=<exact Kush-approved accounts>
StrategiesGrid=<baseline count>
No stale/leftover strategy rows beyond approved baseline=<yes/no>
Evidence location or screenshot references=
git status --short --branch after=
```

## Stop / No-Go

Stop immediately and do not request Add All approval if any item is true:

- `READY_ALGOS_ENABLE_STRATEGIES` is not exactly `false`.
- Desktop is not visible/unlocked.
- NinjaTrader is not running.
- Control Center is not visible/unlocked or is unreadable.
- Any failure popup/modal is present and not explicitly resolved or documented as safe.
- `OrdersGrid` is nonzero, unreadable, or uncertain.
- `PositionsGrid` is nonzero, unreadable, or uncertain.
- Any visible strategy row is enabled, or enabled-state is unreadable.
- Target account set is missing, incomplete, or not explicitly Kush-approved.
- Baseline `StrategiesGrid` is missing, unreadable, or uncertain.
- Stale/leftover strategy rows are present beyond the approved baseline, or stale-row status is unreadable.
- The DJDR/PF selector patch status is ambiguous or the operator cannot confirm the intended patched build/script is the one under review.
- Any unexpected order, position, connection, or strategy state appears.

## Artifacts To Preserve

- Completed `docs\VINCERE_ADD_ALL_RDP_PREFLIGHT_EVIDENCE_TEMPLATE.md`.
- This packet, if annotated during the session.
- `git status --short --branch` before and after preflight.
- Screenshot/report evidence created during the supervised preflight.
- If a later separately approved Add All run occurs: `logs\stack-apply-batches\*.json`, stack apply log output, and any `logs\add-all-diagnostics\<batchId>\` or `%TEMP%\vincere-add-all-diagnostics\<runId>\` paths.

## Required Second Approval Question

Ask this only after every preflight field is recorded and all stop/no-go checks are clear:

```text
Kush, the supervised RDP preflight evidence is recorded: READY_ALGOS_ENABLE_STRATEGIES=false, desktop visible/unlocked, NinjaTrader running, OrdersGrid=0, PositionsGrid=0, all visible strategy rows disabled, target account set confirmed as <exact accounts>, StrategiesGrid=<baseline count>, and no stale/leftover rows beyond the approved baseline. Do you separately approve clicking/running Add All now for this exact account set under supervision, with immediate post-check of OrdersGrid=0, PositionsGrid=0, StrategiesGrid, and all strategy rows disabled?
```
