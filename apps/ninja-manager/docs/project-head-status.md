# Ninja Manager Project Head Status

Last updated: 2026-07-21 (America/New_York)

## Canonical boundary

- Canonical product and implementation: `Vincere/NinjaManager/apps/ninja-manager`.
- `Vincere/Automation` is read-only reference material and is not a runtime dependency.
- Required topology: Next.js control plane -> durable companion/queue -> in-process NinjaTrader Add-On.
- The Add-On is the authority for NinjaTrader state. A browser, queue acknowledgement, or process result alone cannot prove a control succeeded.

## Preserved baseline

- Git branch: `main`, one commit ahead of `origin/main` when implementation began.
- Existing tracked user change: root `README.md` modified.
- The Ninja Manager application was already untracked and is preserved in place.
- Pre-implementation source/config inventory: 186 files, SHA-256 aggregate `6f00d2c4c6e1d5187bf8406ab7bdb00b15233243d96f4990a0032281cda6860d`.
- Custom `.next-seq-*` and `.next-webpack-local` build outputs were added to `.gitignore`; no build output or user data was deleted.
- Runtime at orientation: NinjaTrader and the legacy Operator were running; Ninja Manager listened only on `127.0.0.1:3000`.
- No NinjaTrader process, account, connection, strategy, order, service, firewall, or production schedule was changed during orientation.

## Product decisions

- All default schedule times use DST-aware `America/New_York`.
- Weekdays 08:30 ET: reconcile and enable the exact approved supervised-SIM targets.
- Weekdays 17:00 ET: capture an authoritative EOD snapshot.
- Friday 18:00 ET: revoke enable authority, stop exact approved strategies, verify disabled, and disarm.
- Weekly authority never silently renews; the client explicitly re-arms unless settings are changed through a new approved revision.
- Clients retain permanent control of their own tenant.
- CSM operational visibility is private by default and requires a client-issued, one-use, scoped support grant.
- Blueprint v1 requires XLSX preview and explicit alias-to-authoritative-account mapping. CSV is follow-up.
- Feed research means versioned NinjaTrader/Tradovate issue evidence, deterministic detection, and guided recovery; it is not backtesting.
- NinjaTrader launch and guarded graceful quit are first-milestone capabilities.
- Manual order entry, cancellation, flattening, live/funded mutation, blind reconnect, and blind re-enable are out of scope.

## Current authority and gates

- Existing deployed Add-On IPC is still read-only v1: `PING`, `GET_CAPABILITIES`, and `GET_RUNTIME_SNAPSHOT`.
- Source now has an additive, read-only `GET_RUNTIME_OBSERVATION_V2` client contract; the Add-On implementation, companion wiring, installation, and supervised verification are not yet complete.
- Runtime observation v2 strictly models process/Add-On health, connections, masked accounts, strategies, positions, orders, executions, daily/native/manager P&L availability, freshness, and per-scope completeness.
- V2 account fingerprints plus account/strategy opaque references preserve v1 identity exactly, so existing assignments do not silently retarget during upgrade.
- Authenticated `runtime.observation_v2` events are durably stored and strictly reparsed on tenant-scoped readback. No raw account identifier is accepted by that external contract.
- Process-control contracts and a fake-tested controller exist for allowlisted launch and guarded graceful quit. They are not wired to a queue or OS adapter yet and have not touched the running NinjaTrader process.
- Existing `sim-control/1.0` is a schema/test foundation and is not wired to a queue or actuator.
- Add-On installation, compilation, authoritative SIM reconciliation, and control verification remain supervised runtime gates.
- Unknown, live, funded, stale, ambiguous, offline, or indeterminate targets fail closed.

Verified foundation evidence on 2026-07-21:

- runtime observation contract: 12 focused tests;
- Add-On/companion adapter and cross-version identity: 14 focused tests;
- authenticated event envelope plus canonical hashing: 21 focused tests;
- repository and migration ingestion/readback: 26 focused tests;
- process-control contract: 40 focused tests;
- fake-only process controller: 19 focused tests;
- weekly authority contract: 13 focused tests; and
- full TypeScript typecheck passed after integration fixes.

These are source-level results, not proof that Edith's installed Add-On or companion is connected.

## Active implementation ownership

| Owner | Exclusive paths | Purpose |
|---|---|---|
| Project Head | shared architecture, migrations, repository/queue integration, companion wiring, Add-On integration, final review | integration and safety authority |
| Add-On runtime-v2 worker | `runtime/ninjatrader-addon/VincereNinjaManagerIpcAddOn.cs` | read-only NT 8.1.7.2 observation implementation; no runtime installation |
| Windows process-platform worker | `src/companion/windows-process-platform.*` | injected/fake-tested exact launch and graceful-close OS adapter |
| runtime-v2 collector worker | `src/companion/runtime-observation-collector.*` | authenticated IPC collection plus companion-owned observation assembly |

Workers must stop before modifying unowned files. The Project Head reviews every diff and runs independent tests before integration.

## Milestone order

1. Preserve baseline and freeze reviewed interfaces.
2. Implement authoritative runtime observation v2 and guarded process-control foundations.
3. Persist and render EOD/P&L plus Feed & Algo Health.
4. Implement XLSX blueprint mapping and versioned assignments.
5. Wire exact supervised-SIM controls, weekly scheduling, and guarded recovery.
6. Implement private, OTP-scoped CSM access.
7. Complete independent audits, full regression tests, documentation, and supervised Edith acceptance.

## Completion evidence rule

A control milestone is complete only when evidence binds the authenticated actor, tenant, exact opaque target, approval, expected pre-state, durable command, lease, acknowledgement, and authoritative post-state. Timeout or uncertain mutation is `indeterminate` and is never reported as success or blindly retried.
