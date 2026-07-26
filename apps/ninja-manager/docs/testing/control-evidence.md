# Control-to-test and evidence inventory

## How to read this inventory

This file maps safety and product controls to repeatable evidence. Status values mean:

- **Automated**: implemented and covered by a repeatable repository test.
- **Automated at dashboard boundary**: repeatable browser/API/database evidence exists, but no external companion/Add-On outcome is implied.
- **Schema/interface only**: a durable or typed seam exists without a running provider or processor.
- **Partial**: a safe foundation exists, but the full control boundary is incomplete.
- **Target/unimplemented**: architecture or policy only; no working implementation is claimed.
- **Manual SIM pending**: requires supervised comparison with visible NinjaTrader SIM state.
- **Prohibited**: outside the authorized phase.

An automated test is evidence only for the boundary it exercises. PGlite tests are not evidence of managed PostgreSQL MVCC/TLS behavior. Contract fixtures are not evidence of a real companion or Add-On. A UI toast is not evidence of a database, IPC, Add-On, or NinjaTrader outcome.

## Recorded checkpoint

The fresh checkpoint on 2026-07-14 used an uncommitted `main` worktree one commit ahead of `origin/main`; the parent README is modified and `apps/` remains untracked. No commit, push, deployment, networking, service, or NinjaTrader change was made.

- `npm run typecheck`: passed;
- `npm run lint`: passed;
- `npm test`: 18 files, 91 tests passed; `tests/e2e/**` was not collected by Vitest;
- `npx vitest run src/lib/domain/runtime-contracts.test.ts`: 7 TypeScript contract tests passed;
- `npm run test:contract:csharp`: 2 published cross-language vectors passed;
- `npm run build`: CENTRAL_CONNECTED and LOCAL_ONLY production artifacts and atomically written schema-v2 manifests bound to their fresh Next.js `BUILD_ID` values built successfully;
- `npm run test:listener`: the built LOCAL_ONLY server listened only on `127.0.0.1` and shut down cleanly;
- `npm run db:verify`: all 5 migration filenames and SHA-256 checksums plus two demo-seed passes were verified on fresh PGlite stores in both modes;
- `npm run test:e2e`: 8 tests passed in 3.4 minutes: 5 CENTRAL_CONNECTED and 3 LOCAL_ONLY, including the actual development listener check;
- isolated `agent-browser` sessions independently verified both modes, role/navigation policy, mobile focus/dialog behavior, offline loaded-page behavior, same-origin requests, and empty page-error logs; their loopback servers were stopped and ports closed;
- all eight retained Playwright captures at 360, 768, 1280, and 1600 px were opened and visually inspected. No product clipping, overlap, broken control, or horizontal overflow was found; the visible edge overlay is Next's development indicator.

This is dashboard, fixture, and PGlite evidence. Real managed PostgreSQL, production LOCAL_ONLY storage/identity, companion, IPC, Add-On, and supervised visible NinjaTrader SIM evidence remain separate gates.

### Reconciliation/P4 checkpoint — 2026-07-26

On `reconcile/ninja-manager-edith-20260722`, the proportional P0–P4 source checkpoint records typecheck and lint passing; 64 unit files with 560 passed / 1 skipped; all 15 checksummed migrations and repeatable seed state in both modes; both production builds; the LOCAL_ONLY production listener gate; and 8/8 Playwright tests. The browser prototype uses only the isolated `.data/local-prototype` fixture store and visibly labels demo/local evidence. P4 also verifies globally unambiguous sign-in email identity, fail-closed ambiguous LOCAL_ONLY identity, and client-owned agent scoping for Runtime-v2 reads/queues, process control, and EOD capture.

Commit-bound command results and caveats are recorded in `verification-manifest-a36b923.md`.

Runtime-v2 sequential inventory remains partial by contract. The source companion, authenticated local IPC, Runtime-v2 Add-On implementation, exact process identity, forced-v1/v2 doctor selection, Blueprint approval, EOD capture, and weekly schedule persistence have automated source evidence. None is installed or reconciled on Edith. The separate mutation-readiness command reports `atomicity: not_guaranteed`; its actuation-authority helper always returns false, so it is evidence of a fail-closed seam rather than a verified control outcome.

### LOCAL_ONLY runtime visibility checkpoint — 2026-07-19

This uncommitted checkpoint changes only the web/runtime repository boundary and its tests. It does not install or start a companion, install or compile a NinjaTrader Add-On, invoke `Vincere.Operator.exe`, send IPC, or perform a NinjaTrader mutation.

- `npm run typecheck`: passed;
- `npm run lint`: passed;
- focused runtime action/repository run: 2 files, 25 tests passed;
- `npm test`: 21 files, 99 tests passed;
- LOCAL_ONLY Playwright: 3/3 passed, including durable runtime snapshot rendering, masked account/strategy evidence, loopback-only requests/listener, authorization, accessibility, offline loaded-page behavior, and four responsive widths;
- the CENTRAL_CONNECTED staff runtime journey passed repeatedly, including read-only queue idempotency, delivery integrity, partial/expired evidence, and stale/offline disablement;
- (resolved 2026-07-24, reconcile branch) the stale central client journey that operated the removed `Primary objective` questionnaire has been reconciled: the orphaned client questionnaire (`StrategyForm`/`recommendStrategyAction`) was deprecated in favor of the blueprint workspace, and the two pending approvals the journey needs are now seeded via the real recommendation repository path. The full CENTRAL_CONNECTED and LOCAL_ONLY E2E projects pass (8/8);
- a read-only Playwright check of the active `operator-local-readiness` dashboard returned HTTP 200 with no console, page, request, overlay, or horizontal-overflow errors. It reported companion `offline`, heartbeat `Never`, Add-On `Not reported`, zero accounts/connections/strategies, and a disabled discovery button;
- the optional `agent-browser` CLI was unavailable on the VPS, so installed Playwright provided the live browser check;
- ten temporary PGlite stores from repeated browser runs and two stores from the final central attempt were deleted after path validation when the disk reached `ENOSPC`. These were generated test stores; active and preserved project databases were not touched.

The LOCAL_ONLY Operator route now reads minimized runtime DTOs from the durable companion/event repository instead of product account/configuration fixtures. A local client may read this evidence and queue only the existing strict, dry-run `DISCOVER_RUNTIME_STATE` command when `transport.local` and `runtime.queue` are present. Central client identities remain denied. The UI requires current online heartbeat, Add-On connection, and `runtime.discovery` before enabling the button, and it explicitly marks positions, orders, executions, P&L, and all mutation controls as unavailable.

## Shared application controls

| ID | Control | Status | Repeatable evidence | Remaining evidence |
|---|---|---|---|---|
| APP-AUTH-01 | Browser sessions are hashed, expiring, role-scoped, and evaluated server-side | Partial | Session repository coverage; mode-derived secure-cookie configuration tests; CENTRAL_CONNECTED sign-in validation/wrong-credential journey; LOCAL_ONLY staff-identity rejection in Playwright and agent-browser | Session creation/deletion audit, production login smoke, expiry, disabled-user, lockout, MFA/re-authentication, and recovery journeys |
| APP-TENANT-01 | Client/staff reads and mutations are organization scoped | Automated | Repository isolation test; client staff-route redirect and `/api/v1/clients` 403 in central/local browser suites | Managed-PostgreSQL and adversarial IDOR suite |
| APP-APPROVAL-01 | Strategy deployment record requires one concurrency-safe approved configuration | Automated at dashboard boundary | Conditional transaction test proves concurrent opposing decisions yield one state transition and one matching audit; repository refusal/golden path; central browser approve/reject and persisted deployment/audit outcome | Managed-PostgreSQL concurrency and future Add-On outcome evidence |
| APP-SAFETY-01 | Existing health connector does not claim a live operation | Automated | src/lib/connectors/index.test.ts | Continue labeling all connector UI as simulated |
| APP-KILL-01 | Global kill-switch state is audited | Automated/partial | Repository transaction coverage; central browser enables/disables and verifies both audit events | It is not connected to any external mutation path |
| APP-ERROR-01 | Runtime API errors are typed and do not expose unknown exception details | Automated | src/lib/http/security.test.ts | Browser/network inspection and centralized redacted logging policy |
| APP-CSS-SOURCE-01 | Tailwind source discovery prevents generated-output poisoning | Automated structural guard plus manual smoke | `tests/tailwind-source-boundary.test.ts` requires the Tailwind source base to resolve to `src` and forbids extra explicit `@source` roots, excluding generated Next/test artifacts | Current manual evidence is the live concurrent LOCAL_ONLY/CENTRAL_CONNECTED dev smoke; retain dual-mode browser smoke because this unit test does not compile CSS |
| APP-AUDIT-ATOMIC | All ten product mutations commit business state, completed idempotency evidence, and canonical v1 audit evidence together | Automated on PGlite | Rollback injection covers client creation, onboarding, access, account/environment registration, recommendation/approval creation, approval decision, deployment record, health simulation, incident transition, and kill switch; product, portability, and runtime repository tests recompute the shared hash including actor-subject and occurrence-time snapshots; migration 0005 keeps older rows legacy-unverified | Managed-PostgreSQL concurrency, session lifecycle audit, full origin propagation, database immutability, and external append-only retention/archive proof |
| APP-IDEMPOTENCY-01 | All ten product mutation scopes use the shared exact-replay/changed-intent conflict wrapper | Automated implementation with representative PGlite replay tests | Canonical request hashes bind schema, scope, organization, actor subject, and input; focused tests cover returning, void, sensitive-password, and concurrent duplicate scenarios, while rollback injection exercises all ten scopes; public action tests cover post-commit revalidation failure | Parameterized replay/conflict coverage for every scope, browser retry/crash matrix, and managed-PostgreSQL concurrency |

## Runtime protocol controls

| ID | Control | Status | Repeatable evidence | Remaining evidence |
|---|---|---|---|---|
| RT-CONTRACT-01 | Protocol 1.0 rejects unknown/transformed fields and mutation commands | Automated | runtime contract tests “accepts a strict companion heartbeat…” and “permits only bounded, explicit, typed dry-run read commands” | Cross-language consumer implementation |
| RT-CANON-01 | RFC 8785 canonical bytes and SHA-256 are stable for published vectors | Automated | src/lib/domain/runtime-contracts.test.ts; contracts/runtime-v1/vectors.json; contracts/runtime-v1/csharp/Program.cs | Expand vector corpus before additional language implementations |
| RT-STATE-01 | stateVersion is bound to canonical accounts/strategies content | Automated | “rejects … state-digest reuse” in src/lib/domain/runtime-contracts.test.ts | Supervised Add-On recomputation in C# |
| RT-MIN-01 | Account/strategy fields are masked, opaque, sorted, typed, and secret-resistant | Automated | first two runtime-contracts tests; immutable identity repository test | Manual export/log/screenshot redaction review |
| RT-CRED-01 | Agent tokens are hashed, expiring, rotatable, revocable, tenant-bound, and one-active | Automated | credential/rotation tests in src/lib/repositories/runtime-repository.test.ts; migration unique index | Secure one-time delivery, re-authentication, OS storage, alerting |
| RT-AUTH-01 | Agent/tenant identity comes from bearer credential, not body | Automated | Repository credential/tenant test; central browser/API suite verifies unauthenticated poll 401 and credential-bound poll success | Cross-agent route E2E and production rate limiting |
| RT-EVENT-01 | Event sequences are contiguous; exact replay is idempotent; gaps/stale/conflicts do not partially write | Automated | event evidence tests in src/lib/repositories/runtime-repository.test.ts | Crash/replay test with real companion and real PostgreSQL |
| RT-HEALTH-01 | Heartbeat freshness uses server receipt; snapshot contact cannot hide stale/degraded Add-On state | Automated | Repository stale/degraded tests; central runtime browser verifies stale/offline controls are disabled | Browser degraded fixture and real reconnect |
| RT-SNAPSHOT-01 | Complete snapshot observations and identity bindings are immutable and tenant-scoped | Automated | snapshot/minimized DTO/identity tests in runtime repository tests | Supervised visible NinjaTrader SIM comparison |
| RT-LARGE-01 | Maximum-size strategy inventory is inserted in bounded batches | Automated | “persists large authoritative inventories in bounded batches” | Real PostgreSQL load/resource test |
| RT-CMD-01 | Command capability, expected-state, issue time, expiry, TTL, and semantic idempotency gates | Automated at repository/API boundary | Repository semantic-intent tests; central browser validates input, queues once, verifies duplicate idempotency, polls integrity-bound delivery, and disables stale/offline agents | Real companion rejection/replay evidence |
| RT-EXEC-01 | Execution collection cannot run before a result contract exists | Implemented rejection; targeted test pending | RuntimeRepository explicitly rejects COLLECT_EXECUTIONS | Add a named repository/API rejection test; design result contract; no collection authorized |
| RT-INTEGRITY-01 | Stored payload/semantic/envelope changes are quarantined before delivery | Automated | “quarantines every stored-command integrity mismatch before delivery” | Alert/case routing for integrity failure |
| RT-ORDER-01 | A later command cannot bypass an earlier nonterminal command | Implemented; targeted test desirable | ordering predicate in RuntimeRepository.leaseCommands | Add an explicit named ordering test and real PostgreSQL concurrency test |
| RT-LEASE-01 | Deliveries are durable, credential-attributed, leased, and redeliverable | Automated | “leases queued commands durably and redelivers…” | Companion restart/idempotency and real PostgreSQL SKIP LOCKED test |
| RT-ACK-01 | First acknowledgement requires latest live lease/credential and binds later sequences | Automated | expired/superseded lease, forged time, transition, gap, and partial tests | Companion crash/restart and API route E2E |
| RT-ACK-02 | Acknowledgement message/evidence/error fields are typed and exact replay is idempotent | Automated | acknowledgement contract and repository tests | UI presentation must keep partial/indeterminate distinct from success |
| RT-EXPIRY-01 | Server materializes overdue commands and audits expiry | Automated at dashboard fixture boundary | Repository expiry test; central runtime browser renders seeded expired evidence | Active browser timeout injection and alert/case routing |
| RT-LEGACY-01 | Legacy 0002 evidence is redacted/quarantined rather than promoted | Automated | src/lib/db/runtime-migration-upgrade.test.ts | Production-copy rehearsal and export review |
| RT-API-01 | Agent request JSON is content-type/UTF-8/body-size bounded with safe errors | Automated at helper level | src/lib/http/security.test.ts; route limits in /api/v1/agent handlers | Route-level network E2E for 400/401/403/409/410/413/415 |

## Database controls

| ID | Control | Status | Repeatable evidence | Remaining evidence |
|---|---|---|---|---|
| DB-TX-01 | Database transaction callback commits or rolls back as one unit | Automated on PGlite | src/lib/db/client.test.ts | Repeat against managed PostgreSQL |
| DB-CONFIG-01 | Production fails closed without PostgreSQL and sslmode=verify-full | Automated configuration check | production database configuration tests in src/lib/db/client.test.ts | Establish an actual verified TLS connection |
| DB-MIG-01 | Populated 0002 upgrades safely to hardened 0003 constraints | Automated on PGlite | src/lib/db/runtime-migration-upgrade.test.ts | Rehearse with sanitized production-scale copy and managed PostgreSQL |
| DB-MIG-02 | Applied migrations are checksum-bound and drift/legacy ledgers fail closed | Automated for drift/legacy; missing-file branch implemented | `src/lib/db/migrate.test.ts` proves unchanged rerun, changed-file rejection, and refusal to bless a filename-only legacy ledger; the runner code also rejects an applied filename missing from disk; `npm run db:verify` checks all 14 filenames/checksums | Named missing-file branch test, explicit trusted-baseline procedure, global/cross-process migration lock, and managed-PostgreSQL rehearsal |
| DB-MODE-01 | Every migration and repeatable demo seed produce the correct installation mode | Automated on fresh PGlite stores | `npm run db:verify` applies all 15 checksummed migrations and seed twice, then asserts one mode-correct installation and stable fixture counts for CENTRAL_CONNECTED and LOCAL_ONLY | Atomic production seeding policy and managed-PostgreSQL rehearsal |
| DB-PG-01 | MVCC, row locks, SKIP LOCKED, partial unique index, and TLS work on the production engine | Pending | None in this workspace; Docker/psql/managed disposable DB unavailable | Required real PostgreSQL suite |
| BUILD-01 | Production start selects only a fresh, matching mode artifact | Automated contract plus recorded build | The schema-v2 validator binds mode, directory, timestamp, and Next.js `BUILD_ID`; tests cover output-directory mapping, fresh/reused build IDs, and stale manifest-`BUILD_ID` rejection | Add targeted wrong-mode/wrong-directory assertions; deployment-system artifact provenance/signing and production rollout proof |

## Current runtime staff UI batch

| ID | Control/journey | Status | Code/evidence source | Required final evidence |
|---|---|---|---|---|
| UI-RUNTIME-01 | Staff runtime route lists agent health, capability, heartbeat/contact, Add-On, snapshot, account, strategy, and command evidence | Automated at dashboard fixture boundary | Central Playwright runtime journey covers populated and empty inventory plus online/stale/offline/partial/expired evidence; four-width captures manually inspected | Degraded fixture and real companion/Add-On evidence |
| UI-RUNTIME-02 | Staff queues only read-only supervised discovery | Automated at dashboard/API/database boundary | Central Playwright verifies persisted command row, loading state, idempotent duplicate, authenticated poll, delivery attempt, and all three integrity hashes | Real companion execution/acknowledgement evidence |
| UI-RUNTIME-03 | Invalid/stale/duplicate/offline discovery states fail safely | Automated at dashboard fixture boundary | Central Playwright covers validation with no row, success, loading, duplicate, stale, offline, seeded expiry, and seeded partial evidence | Active timeout/partial injection through a real companion and case routing |
| UI-ROLE-01 | Client cannot access staff runtime controls | Automated | Central and local Playwright redirect signed-in clients; LOCAL_ONLY rejects staff identity and central APIs/controls | Adversarial route/IDOR suite |
| UI-NAV-01 | Staff/client navigation exposes only role-appropriate routes | Automated at dashboard boundary | Playwright visits every staff/client navigation route; LOCAL_ONLY asserts exactly four client links and no staff/central-only controls; agent-browser independently verifies both mode menus and staff-route redirect | Broader adversarial authorization suite |
| UI-A11Y-01 | Forms/dialog/navigation have labels, focus, keyboard, and escape behavior | Automated/partial | Both-mode Playwright axe serious/critical scans; mobile dialog Enter/Escape, focus return, link activation; focusable tables | Full WCAG/manual screen-reader review |
| UI-RESP-01 | No overflow/clipping/overlap at supported widths | Automated and manually inspected at dashboard fixture boundary | Both modes assert no horizontal overflow; all eight full-page captures at 360, 768, 1280, and 1600 px were opened and inspected | Re-run for future user-facing batches and production adapter content |
| UI-RUNTIME-04 | Browser console/network/hydration stay clean | Automated at dashboard fixture boundary | All eight Playwright journeys monitor console errors, page errors, and unexpected request failures; expected 404 is asserted and cleared; agent-browser confirms same-origin requests and empty page-error logs in both modes | Production observability and external-adapter failure diagnostics |
| UI-LOCAL-RUNTIME-01 | LOCAL_ONLY Operator renders durable companion/Add-On status, minimized inventory, and read-only command evidence without exposing central fleet access | Automated at dashboard fixture boundary; live installation truthfully offline | Repository/action tests prove central-client denial and local capability gating; LOCAL_ONLY Playwright proves populated masked snapshot rendering and disabled mutation surface; live port-3000 Playwright proves offline/Add-On-not-reported/zero-inventory state and disabled discovery | Enroll and run a real companion, install the Add-On, and compare visible NinjaTrader SIM state with the resulting snapshot and acknowledgements |

The user-facing quality gate must exercise at least:

- sign-in success, validation, and wrong credentials;
- every staff route and navigation item: /staff, /staff/runtime, /staff/clients, /staff/approvals, /staff/incidents;
- every client route and navigation item: /client, /client/setup, /client/strategy, /client/activity;
- every applicable button, form, and dialog as the correct role;
- loading, empty, success, validation, permission denied, duplicate, stale/offline, timeout, and partial-failure states;
- API/database effects for mutations;
- keyboard/focus/labels/dialog behavior;
- console errors, failed requests, hydration/runtime errors, and broken routes;
- responsive captures at mobile, tablet, laptop, and wide desktop.

The isolated dashboard/API/database user journeys now have repeatable end-to-end browser evidence plus independent responsive visual inspection. This does not establish a production network, companion, IPC, Add-On, or NinjaTrader outcome.

## Dual-mode controls

| ID | Control | Status | Evidence | Remaining evidence |
|---|---|---|---|---|
| MODE-01 | Persist exactly CENTRAL_CONNECTED or LOCAL_ONLY and fail closed otherwise | Automated foundation | deployment contracts/config tests; migration 0004 checks; portability upgrade test | Controlled mode-migration lifecycle |
| MODE-BIND-01 | LOCAL_ONLY dev/start binds exactly `127.0.0.1` and rejects unsafe overrides | Automated | Startup contract tests reject `localhost`, `::1`, public/LAN hosts and every hostname CLI form; Playwright inspects the development listener; `npm run test:listener` inspects the built production listener and verifies shutdown | Installer/OS access policy and production pilot |
| MODE-02 | Same shared domain and UI code runs in both modes without forks | Automated UI foundation/partial overall | Shared deployment contracts/navigation plus 5 CENTRAL_CONNECTED and 3 LOCAL_ONLY Playwright tests | Broader parameterized domain/repository/adapter suites |
| MODE-03 | Adapter boundaries cover identity, tenant directory, secrets, notifications, sync, and transport | Partial | Typed ports in src/lib/deployment/ports.ts; shared profile consumers | Storage port, concrete provider implementations, contract tests, and bypass analysis |
| MODE-04 | LOCAL_ONLY has no cloud dependency | Automated browser boundary/partial production | Local Playwright records only `http://127.0.0.1:3101` requests and keeps a loaded supported route usable during simulated offline state | Network-disabled cold start, authentication, mutations, restart, and recovery |
| MODE-05 | LOCAL_ONLY has no dead central navigation/actions | Automated at dashboard boundary | Local Playwright and agent-browser cover all client routes, central-route redirects, absent strategy remote action, mobile nav, and visually inspected four-width captures | Re-run with production local adapters |
| MODE-06 | CENTRAL_CONNECTED companion is outbound only | Contract only | Profile declares outbound-only connectivity and outbound central queue; no inbound networking was created | Production companion and network-policy/installation proof |
| MODE-07 | Capabilities gate routes and commands in addition to role/mode | Automated static foundation/partial dynamic policy | Deployment contract tests, mode-aware navigation/auth/actions, runtime command capability tests, both-mode browser matrix | Installed-adapter/environment/safety/health/kill-switch capability composition |
| MODE-08 | Changing mode requires migration, recent re-authentication, and audit | Target/unimplemented | None | Success, cancellation, stale re-auth, rollback, and conflict tests |

The configured both-mode browser matrix is 8/8 passing. This is application evidence, not production adapter, synchronization, public-networking, or companion evidence.

## Synchronization, conflict, and case controls

| ID | Control | Status | Evidence | Remaining evidence |
|---|---|---|---|---|
| SYNC-ID-01 | Syncable records have stable ID, origin, schema/record version, idempotency key, actor/time, and tombstone | Automated schema/contract foundation; partial domain coverage | Migration 0004; strict sync-contract tests; portability repository version/tombstone/message evidence | Map every syncable business-domain record; product mutation idempotency does not itself perform synchronization |
| SYNC-OUT-01 | Portable record state, audit, and outbox stage atomically | Automated staging foundation | PortabilityRepository test verifies portable state + sequenced outbox + audit in one transaction and stale-base sequence rollback | Business-domain mapping, delivery leases, crash-point matrix, and retry/dead-letter worker |
| SYNC-IN-01 | Inbox application is ordered/idempotent and separates receipt from business acceptance | Schema/interface only | Migration 0004 status/uniqueness constraints; CentralSyncProvider port | Inbox processor and replay/gap/duplicate/poison/retry tests |
| SYNC-CONFLICT-01 | Assignments/approvals never use last-write-wins | Partial | Explicit authority/conflict policies, stale-base rejection, conflict schema | Assignment integration, concurrent conflict creation, and audited resolution tests |
| SYNC-AUDIT-01 | Target replication rule: copy but never rewrite origin audit evidence | Partial | Shared canonical v1 writer covers product, portability, and runtime repositories; staged portability changes carry origin; pre-canonical rows are legacy-unverified with null hash | No replication has run; ordinary product and runtime rows lack origin installation IDs; no tamper workflow, external append-only archive, or managed retention policy exists |
| CASE-01 | Operational inbox cases are versioned, deduplicated, attributable, and auditable | Target/unimplemented | None | Repository/API/browser lifecycle tests |
| CASE-02 | Partial/indeterminate, sequence gaps, dead letters, sync conflicts, and secret failures create cases | Target/unimplemented | None | Failure-injection E2E |

Existing simulated incidents are not evidence for these cross-mode case controls.

## Secret controls

| ID | Control | Status | Evidence | Remaining evidence |
|---|---|---|---|---|
| SEC-REF-01 | Domain records use secret references, not values | Partial | Runtime tokens store only hash/final four; migration 0004 constrained secret-reference table; SecretsProvider port | Concrete central/local providers and controlled retrieval workflow |
| SEC-REAUTH-01 | Reveal/replace/test requires recent re-authentication | Target/unimplemented | None | Role, timeout, cancellation, and audit E2E |
| SEC-REDACT-01 | Values never appear in logs, audit, UI, cases, screenshots, exports, notifications, or sync | Partial | Runtime contract secret rejection, 0003 redaction test, strict sync envelope rejection of payload fields, portability outbox payload-absence test | Cross-adapter redaction tests and artifact scanning |
| SEC-ROTATE-01 | Rotation/revocation is recoverable and auditable | Automated at repository boundary/partial overall | Runtime credential rotation/revocation tests | Secure delivery, companion storage, offline recovery, expiry alerts |

## External and NinjaTrader evidence

| ID | Outcome | Status | Evidence required before promotion |
|---|---|---|---|
| NT-DISC-01 | Add-On discovers authoritative runtime inventory | Companion/IPC/Add-On source and dashboard boundary implemented; external deployment unverified; manual SIM required | Run the separately approved forced-v1 doctor, then separately install/compile v2 and compare visible NinjaTrader SIM inventory with event/API/database evidence across reconnect/empty/large/partial cases |
| NT-DEPLOY-01 | Approved SIM strategy is Enabled, Sync=true, running, and green | Not implemented; manual SIM pending | Exact approved version, command/ack, Add-On post-state, visible NinjaTrader state, rollback |
| NT-PNL-01 | P&L is reconciled | Source contract/persistence/UI implemented; manual reconciliation pending | Supervised Add-On observations plus independent session/date/source comparison; unsupported realized/native metrics must remain unavailable |
| NT-RISK-01 | Risk shadow mode | Not implemented | Deterministic evaluation against reconciled data with no mutations |
| NT-RISK-02 | SIM risk enforcement | Not implemented | Separate approval, SIM post-action evidence, failure/rollback exercises |
| NT-LIVE-01 | Live enabling/orders/cancel/flatten/account mutation/risk enforcement | Prohibited | No implementation or test may perform these actions in the current phase |
| EXT-NOTIFY-01 | Real Discord/email/SMS/GHL notification | Prohibited in current build | Use fakes only until a separately approved connector phase |
| OPS-DEPLOY-01 | Live deployment/restart/VPS/firewall/service/task/login-policy change | Prohibited | Requires explicit later authorization and separate runbook |

## Final evidence handoff template

For each user-facing batch, record:

| Field | Required value |
|---|---|
| Commit/worktree | Exact uncommitted or commit identity; never imply a commit was made |
| Database | Engine and isolated database identifier |
| Automated commands | Exact command, time, exit status, test count |
| Role/route/control | Staff or client; every exercised path and control |
| Backend outcome | API response plus database/evidence row identifiers |
| Negative states | Validation, permission, duplicate, stale/offline, timeout, partial |
| Browser health | Console, page errors, failed requests, hydration/runtime errors |
| Accessibility | Keyboard/focus/dialog/labels and axe findings |
| Responsive | Width, screenshot path, overflow result, visual inspection |
| External outcome | Mock/simulation/manual SIM/real; never leave ambiguous |
| Gaps | Exact unverified dependency or prohibited action |
