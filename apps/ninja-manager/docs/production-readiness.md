# Production readiness and safety gates

## Current decision

Ninja Manager is **not ready for live client systems, public networking, production deployment, or live NinjaTrader mutation**.

The repository contains one runnable dashboard codebase exercised in CENTRAL_CONNECTED and LOCAL_ONLY, a deployment-portability foundation, and a hardened dashboard-side agent API/queue for supervised read-only runtime discovery. It does not contain:

- the production VPS companion;
- versioned authenticated local IPC;
- the in-process NinjaTrader Add-On;
- production implementations of the identity, tenant-directory, secrets, notification, sync, or local-runtime adapters;
- central sync delivery, inbox application, conflict resolution, or an operational case workflow;
- authoritative live connector evidence;
- any authorized live trading mutation.

Work must proceed in dependency order. A later phase cannot use a schema field, simulated connector, UI toast, or passing unit test as proof that an external outcome occurred.

## Gate 0: preserve one product and establish both modes

Complete these prerequisites before connector deployment or public networking:

1. Persist an explicit CENTRAL_CONNECTED or LOCAL_ONLY deployment mode.
2. Define a controlled migration between modes; mode changes require recent re-authentication and audit evidence.
3. Separate shared domain/UI from identity, tenant-directory, secret-reference, notification, central-sync, transport, and storage adapters.
4. Compute effective capabilities from mode, role, tenant/workspace, installed adapters, agent/Add-On capabilities, environment policy, safety phase, health, and kill switch.
5. Fail closed on unknown mode/capability combinations.
6. Remove dead navigation and unavailable controls in each mode.
7. Prove LOCAL_ONLY performs its supported workflows with the network unavailable and makes no central calls.
8. Prove CENTRAL_CONNECTED uses outbound-only companion connectivity and requires no inbound VPS port.
9. Run the same domain, permission, validation, accessibility, and workflow suites in both modes.

Gate 0 now has an implemented application foundation, but the production gate is not complete:

- Items 1, 5, and 6 have schema/configuration, unit, and browser evidence: production requires an explicit valid mode; installations persist a mode; mode/role/capability profiles fail closed; and LOCAL_ONLY removes staff/central-only navigation and actions.
- Item 3 has typed identity, tenant-directory, secret, notification, sync, and transport ports plus shared consumers, but no storage port, concrete production adapters, or adapter-composition tests.
- Item 4 is partial: mode/role capability policy and runtime health/capability checks exist; installed-adapter, environment/account, safety-phase, and kill-switch composition is not unified yet.
- Item 7 has browser evidence that supported LOCAL_ONLY pages use only the local origin and remain rendered during a simulated offline interval. A cold-start, full-workflow, network-disabled production exercise is still required.
- Item 9 has a passing 8-test Playwright matrix across both modes, including roles, routes, actions, API/database outcomes, a real LOCAL_ONLY development-listener assertion, accessibility checks, and four responsive widths. Broader parameterized domain/adapter suites remain pending.
- Items 2 and 8 remain pending: there is no controlled attach/detach migration and no production companion/network-policy proof.
- Mode-specific production output uses schema-v2 manifests bound to each fresh Next.js `BUILD_ID`; production start rejects a missing, malformed, mode/output-mismatched, or `BUILD_ID`-mismatched artifact. This is artifact-selection evidence, not deployment evidence.

## Gate 1: versioned records, synchronization, cases, and secrets

Before any dual-mode pilot:

1. Add stable origin IDs, schema versions, monotonic record versions, actor/time, idempotency keys, and tombstones to every syncable record.
2. Implement a crash-safe local outbox and idempotent inbox with sequence/version evidence.
3. Define domain conflict rules; do not use last-write-wins for assignments, approvals, audit, commands, acknowledgements, or runtime evidence.
4. Add an operational inbox case model for validation conflicts, stale/offline agents, sequence gaps, dead letters, synchronization conflicts, partial/indeterminate commands, secret failures, and later reconciliation mismatches.
5. Ensure transport receipt and business acceptance are separate states.
6. Store only secret references in domain data. Store values in approved managed or OS-backed providers.
7. Require recent re-authentication and authorization for reveal/replace/test operations.
8. Prove secrets are redacted from logs, audit metadata, rendered props, URLs, cases, notifications, screenshots, exports, and sync payloads.
9. Define backup, restoration, retention, legal hold, redaction, and tamper-evident archival policy for central and local stores.

Gate 1 now has durable prerequisites, not a complete synchronization system:

- Migration 0004 defines installations, stable origin/record identifiers, schema and record versions, base versions, tombstones, authority, sync status, sequenced outbox, inbox receipt/application states, conflict evidence, secret references, and origin/version/hash audit metadata.
- Migration 0005 requires a non-null actor-subject snapshot that is included with occurrence time in the canonical hash, keeps pre-canonical rows explicitly `legacy_unverified` without a hash, and adds the request-hash/completion fields used by product mutation idempotency.
- The strict v1 sync envelope is content-bound and excludes arbitrary/domain/secret payload fields.
- Portable change staging atomically writes record state, sequenced outbox evidence, and audit evidence; stale base versions roll back the sequence claim and mode/tenant/actor boundaries are tested.
- All ten current product mutation scopes atomically commit their business change, completed idempotency result, and canonical v1 audit event. Exact retries replay; changed scope, tenant, actor, or canonical input conflicts. Conditional approval transitions allow only one concurrent decision.
- Inbox processing, outbox delivery/leases, business-domain sync mapping, replay/gap handling, domain conflict resolution, operational cases, generic provider implementations, recent re-authentication, comprehensive redaction scans, and lifecycle/retention policy remain pending.

Runtime credential hashing and legacy evidence redaction remain additional foundations, not completion of this gate.

## Gate 2: central platform readiness

Before a controlled CENTRAL_CONNECTED pilot:

- Provision managed PostgreSQL with point-in-time recovery and sslmode=verify-full.
- Run migrations and runtime concurrency/locking tests against that real PostgreSQL service.
- Exercise transaction, row-lock, SKIP LOCKED, unique-index, failover, backup, and restore behavior.
- Replace demo credentials and remove demo seeding from deployment workflows.
- Add MFA or an approved managed identity provider, password reset, session revocation, lockout, and rate limiting.
- Put secrets in a managed vault and document rotation/recovery.
- Complete external security review, dependency scan, authorization/IDOR testing, and threat modeling for the agent boundary.
- Add centralized structured logs, metrics, traces, uptime monitoring, and named alert ownership without sensitive payloads.
- Define incident severity, support escalation, recovery objectives, and kill-switch runbooks.
- Obtain legal/compliance review for the exact recommendation language and operating model.

The current environment has no disposable real PostgreSQL service, Docker, or psql. Runtime transaction/concurrency evidence is from PGlite only and must not be represented as managed-PostgreSQL proof.

## Gate 3: local-only platform readiness

Before a controlled LOCAL_ONLY pilot:

- Select and threat-model local identity, local durable storage, encryption, OS-backed secrets, local backup/restore, and secure local binding.
- Define installer/update/rollback/recovery behavior without changing VPS, RDP, firewall, scheduled-task, service, or login policy implicitly.
- Prove the product starts, authenticates, operates, audits, backs up, restores, and recovers offline.
- Prove central identity, directory, notification, telemetry, and synchronization adapters are disabled rather than repeatedly failing.
- Prove all central-only routes, navigation, actions, and background requests are absent.
- Define local operator/admin recovery and recent re-authentication for sensitive actions.
- Prove a later explicit central migration preserves stable IDs, versions, cases, and audit without transferring secret values.

The same application now runs in LOCAL_ONLY with a client-only identity policy, local-mode labels, capability-derived navigation/actions, an exact `127.0.0.1` managed dev/start dashboard listener, rejection of hostname CLI overrides and any other bind host, and a requirement that APP_URL use `127.0.0.1` with the configured port. Socket tests inspect both the development server and built production artifact. The browser suite verifies all four client routes, denial/redirect of staff and central-only surfaces, same-origin requests, a simulated offline interval, keyboard-safe mobile navigation, axe serious/critical checks, and 360/768/1280/1600 px containment. The loopback HTTP listener is not companion/Add-On IPC.

This is application-foundation evidence only. Production local identity, MFA/re-authentication, encrypted storage, OS-backed secrets, installer/update/recovery, backup/restore, offline cold start, companion/local IPC, and an audited central attach/detach migration remain required before a pilot.

## Gate 4: companion and Add-On read-only pilot

1. Complete staff enrollment, one-time credential delivery, rotation, revocation, expiry alerts, and re-authentication workflows.
2. Enforce verified production TLS and rate limits; decide whether request signing, mTLS, or source-network policy is required.
3. Build the companion with OS-backed credential storage, durable event outbox, command journal, bounded retry/backoff with jitter, offline replay, dead-letter handling, and upgrade/rollback recovery.
4. Publish and test versioned, authenticated, local-only IPC. Do not expose a general remote-control port.
5. Build the in-process Add-On only on documented NinjaTrader APIs and verify threading, lifecycle, workspace, reconnect, and shutdown behavior.
6. Bind enrollment mode, environment, account types, collection mode, and every command to reviewed capability policy.
7. Prove authoritative account/strategy discovery against visible NinjaTrader SIM state, including empty, duplicate, stale, disconnected, large, and partial-read cases.
8. Prove stable opaque identities without exporting raw account identifiers.
9. Prove sequence gaps, exact replay, idempotency conflicts, state mismatch, expiry, stored-integrity failure, lease loss/redelivery, acknowledgement binding/transitions, credential rotation, and offline recovery.
10. Add metrics/cases for heartbeat staleness, queue depth, delivery attempts, expiry, partial/indeterminate results, credential expiry, and dead letters.
11. Prove every staff/client control end to end through browser, API, database, companion, local IPC, Add-On, and visible SIM state as applicable.

The dashboard-side protocol and supervised fixture evidence exist. The actual companion, IPC, Add-On, and supervised NinjaTrader SIM comparison do not.

## Gate 5: assignment import and approved SIM deployment

Only after Gates 0–4:

1. Define versioned CSV schema, stable client/account/strategy references, row-level provenance, and file-level idempotency.
2. Build preview and validation with explicit valid, invalid, duplicate, ambiguous, unauthorized, stale, and partial rows.
3. Require staff approval of the exact validated assignment version.
4. Convert conflicts and partial applications into operational cases.
5. Restrict deployment to reviewed SIM accounts and an exact approved configuration/state version.
6. Verify Enabled=true, Sync=true, running state, and green/healthy post-action evidence from the Add-On.
7. Treat timeout, stale state, reconnect, partial, and indeterminate outcomes as not verified.
8. Add an independently exercised rollback/disable procedure in SIM.

No CSV assignment import or Add-On-driven SIM deployment exists yet. The current “deployment recorded” dashboard action records status only and does not change NinjaTrader.

## Gate 6: reconciled reporting and risk phases

Only after approved SIM deployment evidence:

- Define versioned execution, position, order, and P&L contracts with source timestamps and stable IDs.
- Reconcile Add-On observations against approved reporting sources and make mismatches visible as cases.
- Prove timezone/session boundaries, fees, partial fills, reconnects, corrections, duplicates, late data, and empty periods.
- Run risk logic in shadow mode with no authority to mutate.
- Progress to SIM-only enforcement only after reviewed shadow evidence, explicit approval, post-action verification, and rollback.

Live strategy enabling, order placement/cancellation, flattening, account mutation, and live risk enforcement remain prohibited.

## Current implemented safeguards

- Strict runtime v1 heartbeat, snapshot, command, delivery, and acknowledgement schemas.
- RFC 8785 canonicalization identifier, published JSON vectors, and TypeScript/C# vector verification.
- Content-bound stateVersion over canonical account and strategy content.
- Masked account identifiers, keyed fingerprints, opaque stable references, allowlisted labels/codes, and immutable identity bindings.
- Hashed, expiring, rotatable, revocable agent credentials with one-active-credential database invariant.
- Tenant/agent identity derived from the bearer credential.
- Transactional contiguous event sequence, exact replay, and gap/stale conflict behavior.
- Dry-run-only read command contract, capability and expected-state gates, ten-minute maximum TTL, and semantic idempotency.
- Stored-command payload/semantic/envelope hash revalidation before delivery.
- Per-agent nonterminal command ordering, credential-attributed leases, redelivery, and bound acknowledgement sequences.
- Typed acknowledgement evidence/message/error codes; partial and indeterminate are terminal.
- Materialized expiry and audit summaries.
- Migration-time quarantine/redaction of legacy unverified runtime evidence.
- Bounded authenticated agent APIs with safe error mapping.
- Production database configuration rejects PGlite and requires PostgreSQL sslmode=verify-full.
- CENTRAL_CONNECTED and LOCAL_ONLY production builds use separate deterministic output directories and atomically written schema-v2 manifests tied to the mode, output directory, timestamp, and fresh Next.js `BUILD_ID`; `start` rejects a missing, malformed, mode/output-mismatched, or `BUILD_ID`-mismatched artifact.
- Staff runtime evidence page and supervised read-only discovery action.
- Explicit CENTRAL_CONNECTED/LOCAL_ONLY profiles with role, capability, authority, connectivity, and runtime-transport policy.
- Production fail-closed mode selection and a managed LOCAL_ONLY listener bound to exactly `127.0.0.1`, with development and production-start socket evidence.
- Portable provider interfaces for identity, tenant directory, secret references, notifications, central sync, and runtime transport.
- Versioned installation/portable-record/outbox/inbox/conflict/secret-reference schema plus strict content-bound sync envelopes.
- Transactional portable record, sequence, outbox, and audit staging with stale-version rollback and tenant/actor checks.
- Five checksum-ledger migrations; startup fails closed for a changed or missing applied file and for a legacy filename-only ledger without an explicitly trusted baseline.
- Atomic idempotency plus canonical v1 audit writes for all ten product mutation scopes, conditional concurrency-safe approval/incident transitions, serialized recommendation versions, and replay/conflict/rollback/concurrency tests on PGlite.
- One shared audit writer across product, portability, and runtime repositories binds event/tenant/entity metadata, a stable actor-subject snapshot, occurrence time, and optional origin in the evidence hash; pre-canonical rows remain explicitly legacy-unverified.
- Committed server actions remain successful when cache revalidation fails, preventing a false failure from encouraging unsafe retries.
- A passing 8-test Playwright matrix across CENTRAL_CONNECTED and LOCAL_ONLY with real application/API/database assertions, negative states, accessibility checks, keyboard behavior, clean browser diagnostics, actual dev-listener evidence, and four responsive widths.

These safeguards prove only the implemented dashboard boundary and automated fixtures. They do not prove a real external or NinjaTrader outcome.

## Current limitations

- The global kill switch changes dashboard state but is not connected to an external system.
- Health connectors are simulations.
- “Deployment” is a database record, not a NinjaTrader action.
- No production companion, local IPC, or NinjaTrader Add-On exists.
- Current runtime authority is supervised simulation only.
- collectionMode=authoritative_read_only is parsed but not policy-bound to a reviewed Add-On/environment.
- COLLECT_EXECUTIONS is explicitly disabled and has no result-event or persistence contract.
- Credential lifecycle exists in the repository but lacks complete secure staff UI/API delivery.
- Only read-only discovery is exposed in the runtime staff UI.
- Deployment-mode profiles, adapter ports, sync tables, and atomic outbox staging exist; concrete provider adapters, sync transport/inbox application, a conflict resolver, and a cross-mode operational-case workflow do not.
- Production LOCAL_ONLY identity/storage/secrets adapters are not selected; current production database policy still requires PostgreSQL with `sslmode=verify-full`.
- Session creation/deletion audit, full origin-installation propagation (only staged portability events currently carry origin), an external append-only audit archive/retention policy, and global/cross-process migration locking remain incomplete. The checksum and canonical-hash ledgers detect defined drift; they do not by themselves make PostgreSQL storage immutable or tamper-proof.
- Existing incidents are a simulated guided workflow, not the required operational inbox.
- The rules engine has starter strategies and still needs domain-owner calibration.
- Notifications are dashboard-only; real email/SMS/Discord/GHL delivery is not approved.
- The 2026-07-14 uncommitted checkpoint records typecheck and lint passing; 18 unit files/91 tests; seven TypeScript contract tests and two C# vectors; both schema-v2/`BUILD_ID`-bound production builds; the production LOCAL_ONLY socket gate; all five checksummed migrations plus repeat seed verification in both modes; and 8/8 Playwright tests. Independent `agent-browser` passes covered CENTRAL_CONNECTED and LOCAL_ONLY navigation, permissions, offline behavior, focus/dialog semantics, same-origin requests, and empty page-error logs. All eight retained 360/768/1280/1600 screenshots were opened and visually inspected; no product clipping, overlap, or horizontal overflow was found.
- Real PostgreSQL MVCC/SKIP LOCKED/TLS runtime behavior is unverified in this workspace.

## Evidence policy

testing/control-evidence.md is the control inventory. A control may be marked:

- **Automated** only when a repeatable test exists and its outcome is verified;
- **Manual pending** when supervised external evidence is still required;
- **Target/unimplemented** when architecture exists only in this document;
- **Prohibited** when the action is outside the authorized phase.

A toast, screenshot without backend evidence, schema acceptance, simulated fixture, or unit test alone cannot establish an end-to-end external outcome. Browser evidence must include role, route/control, console/network state, API/database result, validation/permission/error cases, keyboard behavior, and responsive inspection.

See runtime-protocol-v1.md for the exact protocol and architecture.md for deployment-mode authority.
