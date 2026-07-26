# Ninja Manager Project Head Status

Last updated: 2026-07-26 (America/New_York)

## Canonical boundary

- Canonical product and implementation: `Vincere/NinjaManager/apps/ninja-manager`.
- `Vincere/Automation` is read-only reference material and is not a runtime dependency.
- Required topology: Next.js control plane -> durable companion/queue -> in-process NinjaTrader Add-On.
- The Add-On is the authority for NinjaTrader state. A browser, queue acknowledgement, or process result alone cannot prove a control succeeded.

## Reconciliation branch — current status (2026-07-26)

- Repository `KushKeswani/vincere-ops`; branch `reconcile/ninja-manager-edith-20260722`, currently durable at remote commit `3e02ab0`. This branch is the continuity source of truth. The Edith transfer snapshot (268 filtered source files) was reconciled onto it by the coordinator; the legacy `Vincere/Automation ` and preserved `Vincere/NinjaManager` checkouts remain untouched. No merge to `main`.

### Landed milestones

- `41ec0f8` — Baseline gate fixes (independent audit: SOUND):
  - `OccurrenceTransitionRow` was missing `agent_id`, which the transition hash reconstruction reads (typecheck/build).
  - `countCurrentlyArmedAuthoritiesForAgent` added the missing lower bound `armed_at <= now` so not-yet-started authorities are not counted (unit).
  - `requireRuntimeReader`/`requireRuntimeCommander` restored the staff `fleet.runtime` path (staff via `fleet.runtime` OR `transport.local`; client via `transport.local`; **client-central stays FORBIDDEN**), fixing the seed actor's rejection in `db:verify` + E2E. Mirrors the action-layer authorization.
  - Playwright webServers set `PORT` so the pre-dev `db:seed` passes the LOCAL_ONLY `APP_URL===PORT` check.
- `51c0d1f` — E2E-spec reconciliation to current source (independent audit: SOUND, no defect masked):
  - `local.spec` blueprint field label (`XLSX workbook`) + button (`Preview and stage workbook`), asserted enabled (LOCAL_ONLY enables blueprint upload); activity heading aligned to shipped copy.
  - `central.spec` removed the unwired client strategy-questionnaire flow. The two pending approvals it depended on are now **seeded** via the real `createStrategyRecommendation` path (CENTRAL_CONNECTED-gated, idempotent), preserving the wired staff approve/reject + client deployment coverage.
  - Both specs wait for the mobile-nav sheet to close before the a11y scan, removing a transient sheet-close-animation color-contrast false positive (active link static contrast ~14.5:1).
- `a6c7399` / `3e304be` — pinned the project-local Node.js 24.14.0/npm 11.12.1 toolchain and recorded the clean commit-bound baseline verification manifest.
- `dd15ac6` — added the isolated `LOCAL_ONLY` fixture prototype launcher, explicit fixture/demo/local evidence labels, Runtime-v2 fixture ingestion, Operator dashboard, and Blueprint preview/approval surface. The launcher binds only `127.0.0.1`, uses `.data/local-prototype`, and cannot contact or actuate NinjaTrader.
- `3e02ab0` — repaired Runtime-v2 safety contracts: sequential inventory remains honestly partial; exact opaque process identity is produced; forced-v1/v2 doctor selection is explicit; Blueprint and weekly-authority persistence accept only the narrowly usable sequential partial shape; and a separate authenticated mutation-readiness seam was added.

### Green gates (source-level; LOCAL_ONLY + CENTRAL_CONNECTED)

typecheck, lint, unit (64 files; 560 passed / 1 skipped), `db:verify` (15 checksummed migrations in both modes), build (both modes), listener gate, and Playwright E2E (8/8). These prove source/domain behavior only — NOT that Edith's installed Add-On/companion is connected. No "SIM-verified production-ready" claim until an approved supervised Edith Sim101 session proves the full chain (Definition of Done).

### Product decision — client strategy questionnaire

Deprecated in favor of the blueprint workspace as the single client assignment path. **Done** (commit on this branch): removed `StrategyForm` (`src/components/forms/strategy-form.tsx`), `recommendStrategyAction` + its now-unused `requireDeploymentCapability`/`questionnaireSchema` imports (`product.ts`), and `questionnaireSchema` (`schemas.ts` + its test). Preserved (still consumed): the `StrategyQuestionnaire` type, the `recommendStrategy` engine, `createStrategyRecommendation` (used by the seed + tests + the staff-approval/deployment flow), and the staff approval + client deployment surfaces. All gates green after removal.

Follow-up product question: with the client questionnaire removed, `strategy_configurations` now have no production creator — the staff approve/reject + client deployment surface is exercised only by seeded fixtures. Confirm whether that flow should migrate onto the blueprint approval path or be retired, so there is genuinely one client assignment path end-to-end.

### Open risks

- The authoritative layer (companion → local IPC → in-process Add-On) is source-complete but UNVERIFIED against real NinjaTrader — the gating dependency for every real-outcome feature.
- NinjaTrader exposes no demonstrated transaction spanning accounts, strategies, positions, and orders. The new preflight proves only bounded consecutive stability, reports `atomicity: not_guaranteed`, and deliberately cannot authorize actuation. Graceful quit and every future SIM mutation remain fail-closed.
- CENTRAL_CONNECTED staff detailed Runtime-v2 reads still use fleet role authority rather than validating the existing client-issued, staff-bound, scoped support grant. Treat central detailed evidence as release-blocked until that grant is wired at the repository/page boundary.
- `deploymentAllows` (runtime-repository) swallows deployment-configuration errors (fail-closed, but a misconfig surfaces as FORBIDDEN rather than a clear config error) — diagnosability follow-up.
- Period-cycling semantics for M6/M7 (a period flip rotates active account-groups vs. swaps stacks on the same accounts; non-active-period strategies must be disabled/flat) require Kush's confirmation before implementation.

### M2 status — local prep COMPLETE; Edith steps awaiting approval

Local prep done (commits `bf5c138`, `b04e1c2`): fields (a)–(g) — connections+state, masked accounts, strategies+enabled, positions, working/completed orders, executions, realized/unrealized daily P&L — were already modeled/persisted/rendered. This branch added the v2 discovery dashboard to the **staff** runtime page and an **evidence-provenance** card (protocol/collector/authority + state integrity digest), respecting the tested design that excludes opaque per-entity references, account fingerprints, raw process ids, and the envelope observationId from the UI. Companion + heartbeat + Add-On health are already surfaced on **both** the staff and client consoles from `agent_installations` liveness (design decision: companion-plane liveness stays out of the authenticated observation). Freshness, `ipcAuthenticated` (auth), provenance digest, and `asOf`/`receivedAt` (reconciliation) are all surfaced.

**Blocked on Edith:** the deployed Add-On is read-only v1, so full v2 discovery requires a supervised install/recompile. Runbook + two-part approval request: `docs/runbooks/m2-edith-read-only-discovery.md` — Step A (read-only v1 bring-up, no writes) and Step B (Add-On install/recompile, write + maintenance window). Awaiting Kush's explicit per-step approval.

### Next local milestone (proceeding while the Edith approval is pending)

P4 proportional regression/browser audit and server-side client ownership are complete locally: Runtime-v2 reads/queues, process control, and EOD capture bind client access through agent → environment → client ownership; ambiguous LOCAL_ONLY identity fails closed; sign-in email identity is globally unambiguous. Blueprint preview/mapping/approval and weekly schedule persistence exist, but neither has a scheduler or NinjaTrader actuator. The next external step is the separately approved forced-v1 Edith doctor. M6/M7 can connect records to exact-target SIM controls only after a genuinely atomic preflight becomes available and the period-flip decision is confirmed. Central support-grant enforcement, MFA, UI/release hardening, packaging, and deployment remain later milestones.

## Historical preserved baseline

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

- Existing deployed Edith Add-On IPC is still read-only v1: `PING`, `GET_CAPABILITIES`, and `GET_RUNTIME_SNAPSHOT`.
- Branch source implements five authenticated read-only IPC commands: those three plus `GET_RUNTIME_OBSERVATION_V2` and `GET_MUTATION_READINESS_PREFLIGHT`. Companion and Add-On source wiring are implemented; installation, runtime compilation, packaging/recovery, and supervised Edith verification are not.
- Runtime observation v2 strictly models process/Add-On health, connections, masked accounts, strategies, positions, orders, executions, daily/native/manager P&L availability, freshness, and per-scope completeness.
- Runtime-v2 collections are sequential display/reconciliation evidence. Accounts, connections, strategies, positions, orders, executions, and P&L remain `partial / CAPABILITY_UNSUPPORTED` even when all rows validate; no consumer may promote them to atomic completeness.
- V2 account fingerprints plus account/strategy opaque references preserve v1 identity exactly, so existing assignments do not silently retarget during upgrade.
- Authenticated `runtime.observation_v2` events are durably stored and strictly reparsed on tenant-scoped readback. No raw account identifier is accepted by that external contract.
- Process-control contracts, durable queue/API, companion runner, exact-path Windows adapter, and guarded controller exist in source. They are disabled unless an explicit local config opts in and have not touched Edith. Launch still requires fresh authenticated Add-On readiness; graceful quit cannot actuate because the current mutation-readiness protocol truthfully reports non-atomic evidence.
- Existing `sim-control/1.0` is a schema/test foundation and is not wired to a queue or actuator.
- Blueprint preview/mapping/approval, immutable EOD capture, and weekly settings/authority/occurrence persistence are implemented source boundaries. No schedule executor or Add-On-driven strategy mutation exists.
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

## Current implementation ownership

The Project Head owns integration and safety review across the dashboard, repository/queue, companion, local IPC, Add-On source, and documentation. Prior bounded worker assignments are complete; no worker ownership table is currently active. No source milestone changes Edith until Kush approves the applicable supervised runbook step.

## Milestone order

1. Preserve branch durability and the pinned, commit-bound reproducibility baseline — complete.
2. Deliver and verify the isolated fixture-only local browser prototype — complete at the source/browser boundary.
3. Keep Runtime-v2 sequential evidence partial and repair every non-mutating consumer to accept only its narrow usable shape — complete in source.
4. Obtain separate approval for the forced-v1 read-only Edith doctor, then record supervised evidence.
5. Obtain separate maintenance approval for Add-On installation/recompile and Runtime-v2 read-only reconciliation.
6. Prove a supported atomic exact-target mutation preflight; until then process and SIM mutation stay blocked.
7. With authenticated client ownership complete locally, enforce central support grants, then complete companion deployment/recovery, exact SIM controls, Blueprint/schedule/EOD execution, MFA/auth/UI hardening, packaging, and release evidence in that order.

## Completion evidence rule

A control milestone is complete only when evidence binds the authenticated actor, tenant, exact opaque target, approval, expected pre-state, durable command, lease, acknowledgement, and authoritative post-state. Timeout or uncertain mutation is `indeterminate` and is never reported as success or blindly retried.
