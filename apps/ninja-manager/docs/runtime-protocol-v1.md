# Runtime protocol v1.0

## Status and authority

This document describes the dashboard-side protocol implemented by:

- src/lib/domain/runtime-contracts.ts
- src/lib/repositories/runtime-repository.ts
- src/lib/auth/agent.ts
- src/lib/http/security.ts
- the /api/v1/agent/* route handlers

Protocol 1.0 accepts strict, typed events and only dry-run read commands. The current staff surface exposes DISCOVER_RUNTIME_STATE only. Operational authority remains **supervised simulation**. The repository contains an initial companion, documented/authenticated local IPC v1, and offline-compiled in-process Add-On source, but they have not been installed or reconciled against a supervised NinjaTrader SIM session and are not production deployments.

Nothing in protocol 1.0 enables a strategy, mutates an account, places or cancels an order, flattens a position, or enforces live risk. COLLECT_EXECUTIONS is present in the schema for compatibility planning but the repository rejects it until a versioned result-event and persistence contract exists.

The snapshot schema accepts collectionMode authoritative_read_only, but schema acceptance is not proof that a reviewed Add-On produced the data. Until companion, IPC, Add-On, capability, environment, and supervised-SIM gates pass, operators and downstream code must authorize only supervised_simulation.

## Deployment modes

Ninja Manager must remain one product with two deployment modes, not two forks:

| Mode | Intended transport | Intended authority |
|---|---|---|
| CENTRAL_CONNECTED | An outbound-only companion connects to the central dashboard API over authenticated HTTPS | Central dashboard owns client operations; the Add-On remains authoritative for observed NinjaTrader runtime state |
| LOCAL_ONLY | The dashboard currently binds exactly to `127.0.0.1`; secure local adapters and IPC remain targets, with no cloud dependency in the completed mode | The local installation owns operational records; the Add-On becomes authoritative for observed NinjaTrader runtime state only after that target integration is implemented and verified |

Mode selection, capability/authority profiles, provider ports, persisted installation metadata, and portable sync records are implemented outside the runtime v1 wire contract. Protocol 1.0 provides the dashboard-side API, durable queue, wire contract, and an initial outbound companion transport client. The companion remains loopback-development and supervised-SIM only until installation, recovery, reconciliation, and packaging gates pass. Adding deployment mode to a signed/hashed runtime wire object would be a contract change and must not be done silently.

The managed LOCAL_ONLY `127.0.0.1` HTTP listener serves the dashboard only. It is not the local IPC shown in the target topology. The separately launched companion can bridge that dashboard API to authenticated local IPC after supervised installation, but this does not make LOCAL_ONLY runtime discovery authoritative.

The shared domain now exposes explicit ports for identity, tenant directory, secret references, notifications, central synchronization, and transport. Mode-aware authorization, navigation, and actions consume a shared deployment profile; LOCAL_ONLY browser tests verify that central-only staff controls are absent and requests stay on the local origin. Concrete production adapters and production deployment/recovery of the implemented outbound-only companion remain incomplete.

See architecture.md for the implemented authority/portability seams and remaining authority matrix, and production-readiness.md for the prerequisite gates.

## Product boundary

The runtime path extends Ninja Manager; it does not create another operations product.

~~~text
Client/staff browser
  -> Ninja Manager dashboard and authenticated staff controls
  -> PostgreSQL command queue, event evidence, observations, and audit log

VPS companion (initial read-only implementation; not installed/proven)
  -- outbound HTTPS with an agent bearer credential --> Ninja Manager agent API
  <-> versioned, authenticated local IPC v1
  <-> in-process NinjaTrader Add-On (offline-compiled source; not installed/proven)
       -> authoritative NinjaTrader state in a later gated phase
~~~

The companion is a transport and durability boundary; it must not invent NinjaTrader state. The Add-On source is the only component permitted to call documented NinjaTrader APIs and may label observations authoritative only after supervised installation, review, and SIM reconciliation.

The separate Vincere/Automation project may be consulted only as a read-only source of reusable operator and Add-On foundations. Reused logic must be intentionally consolidated into the companion or Add-On. Automation is not a runtime dependency, must not be modified by this work, and must not become a third control plane.

## Trust boundaries

| Principal | Authentication | Implemented authority |
|---|---|---|
| Client or staff browser | Database-backed HTTP-only session cookie | Role- and organization-scoped dashboard operations |
| Staff runtime operation | Staff session plus repository role and tenant checks | Inspect runtime evidence and enqueue supervised, read-only discovery; credential lifecycle exists at repository level but lacks a complete staff workflow |
| Source VPS companion/current authenticated API fixture | Authorization: Bearer agent-token | Submit ordered events, poll only its own commands, and acknowledge only its own leased commands; production installation/recovery remains unverified |
| NinjaTrader Add-On source | Authenticated same-user local IPC | Read-only v1/v2 source implementation exists; no deployed or supervised runtime authority exists yet |

Organization, agent, credential, and protocol version are derived from the stored bearer credential, not request JSON. Browser sessions and agent credentials are separate and not interchangeable.

Production must terminate verified TLS before agent routes. Production database configuration also fails closed unless a non-PGlite PostgreSQL URL uses sslmode=verify-full. The application does not currently provide mTLS, request signatures, source-network restrictions, or rate limiting.

## HTTP transport

Agent endpoints require Content-Type application/json, reject invalid UTF-8 or JSON, stream-enforce body limits, authenticate before repository work, and use typed error responses. Successful responses use Cache-Control: no-store.

| Endpoint | Request limit | Result |
|---|---:|---|
| POST /api/v1/agent/events | 5,000,000 bytes | Stores a heartbeat or complete snapshot; 202 when new, 200 for an exact replay |
| POST /api/v1/agent/commands/poll | 8,192 bytes | Accepts limit 1 through 10, default 5; returns leased command entries and serverTime |
| POST /api/v1/agent/commands/{commandId}/acknowledgements | 262,144 bytes | Path and body command IDs must match; 202 when new, 200 for an exact replay |

Enrollment, rotation, revocation, and most command administration remain repository operations. The implemented staff UI provides inventory/health evidence and one supervised read-only discovery action with a two-minute TTL.

## Bearer credential lifecycle

- Staff enrollment is tenant-scoped and may bind an agent only to an environment in the same organization.
- Enrollment creates a vnm_ token from 32 random bytes. The raw value is returned once; only its SHA-256 hash and final four characters are stored.
- A database constraint permits only one non-revoked credential per agent.
- Credentials expire after 90 days. Authentication rechecks expiry, revocation, agent disablement, and exact protocol compatibility, then records server-side contact.
- Rotation serializes on the agent, revokes the current credential, inserts the replacement, links replaced rows, and writes audit evidence in one transaction.
- Revocation disables the agent, revokes active credentials, and writes audit evidence in one transaction.

Missing production work includes secure one-time delivery, OS-backed local storage, lifecycle UI/API, expiry alerts, emergency procedures, rate limiting, and deployment TLS/mTLS policy. Raw credentials must never enter rendered props, logs, audit metadata, screenshots, support exports, or synchronization payloads.

## RFC 8785 canonical JSON and hashes

All protocol hashes use RFC 8785 canonical JSON serialized as UTF-8 and lowercase SHA-256 values prefixed with sha256:. The TypeScript implementation:

- orders object property names by UTF-16 code unit;
- preserves array order;
- uses ECMAScript JSON number/string serialization, including normalizing negative zero to zero;
- rejects non-finite numbers, undefined, functions, symbols, bigint, and lone Unicode surrogates.

Published language-neutral vectors live in contracts/runtime-v1/vectors.json. They cover Unicode/key order/number rendering and the empty runtime state. The TypeScript contract test verifies the RFC 8785 vector, and the C# verifier checks both published vectors. Passing these examples is cross-language evidence for the published vectors, not a claim that every possible serializer behavior has been exhaustively proven.

| Value | Covers | Purpose |
|---|---|---|
| Event payloadHash | Typed event payload | Detect payload corruption or conflicting replay |
| Event envelopeHash | Entire event except envelopeHash | Bind identity, sequence, time, type, payloadHash, and payload |
| Snapshot stateVersion | Canonical {accounts, strategies} content | Bind expected state to the complete observed inventory |
| Command payloadHash | Typed command payload | Bind the delivered payload |
| Command semanticHash | Protocol, agent, command type, expected state, approval, dry-run flag, and payload | Compare idempotent business intent while excluding retry IDs/timestamps |
| Command envelopeHash | Full command plus canonicalization, payloadHash, and semanticHash | Bind the exact delivered command envelope |
| Acknowledgement evidenceHash | Typed acknowledgement evidence | Detect evidence corruption |
| Acknowledgement hash | Entire acknowledgement, including evidenceHash | Detect conflicting acknowledgement replay |

Hashes provide integrity and replay comparison, not a signature or MAC. Authenticity currently depends on the bearer credential plus transport security.

## Agent events

### Common envelope

Every event is a strict object; unknown keys are rejected. It carries literal protocol 1.0, UUID event and agent IDs, a positive agent-wide sequence, nullable correlation and causation IDs, an offset timestamp, payload and envelope hashes, an event type, and a typed payload.

The authenticated agent must match the envelope. Event and payload observation timestamps more than five minutes in the future are rejected. Liveness uses server receipt time rather than the agent clock.

### Heartbeat

agent.heartbeat has source vps_companion_agent and includes observedAt, agentVersion, online/degraded health, Add-On connection/version, and pending durable-event count. It updates heartbeat freshness and server contact. Staff inventory derives stale after two minutes without a received heartbeat. A snapshot updates contact but does not promote heartbeat freshness or hide a degraded/disconnected Add-On.

### Complete runtime snapshot

runtime.snapshot has source ninjatrader_addon and includes collection mode, complete=true, observedAt, Add-On version, content-bound stateVersion, at most 500 accounts, and at most 10,000 strategies.

Accounts use:

- a stable opaque acct_ reference;
- an ASCII-only masked identifier;
- a keyed HMAC-SHA-256 fingerprint;
- an allowlisted display label, account type, connection kind, and connection status.

Strategies use:

- a stable opaque strat_ reference bound immutably to account reference and strategy type;
- allowlisted display, instrument, timeframe, runtime-state, and state-code fields;
- Enabled and nullable Sync values.

A running strategy requires Enabled=true and Sync=true. A disabled strategy cannot report an active state. Account and strategy sets must be sorted and unique; duplicate account fingerprints are rejected; every strategy must reference an account in the same snapshot. Stored account-ref/fingerprint and strategy-ref/account/type bindings cannot change across snapshots.

complete=true makes absence meaningful, including a valid empty inventory. Partial or incremental snapshots are not part of protocol 1.0.

### Sequence and replay

The companion persists its next event sequence with its crash-safe outbox. Under a transaction and agent row lock, the server accepts exactly last_event_sequence + 1:

- same event ID, sequence, and envelope hash: exact idempotent replay;
- same event ID with different evidence: CONFLICT;
- lower unseen sequence: SEQUENCE_STALE;
- higher sequence: SEQUENCE_GAP with expectedNextSequence so the caller can replay the durable outbox in order.

The event, identity bindings, observations, sequence update, and relevant audit evidence commit atomically. Strategy observations are inserted in batches of 200.

## Read-only commands

Every strict command contains UUID command/correlation/agent IDs, an idempotency key, issue and expiry times, nullable expected-state and approval IDs, literal dryRun=true, typed command type, and typed payload.

| Command | Typed payload | Current authority |
|---|---|---|
| DISCOVER_RUNTIME_STATE | Sorted discovery scopes, forceFullSnapshot=true, reasonCode=STAFF_RUNTIME_REFRESH | Implemented staff action; supervised simulation only |
| COLLECT_ACCOUNT_SNAPSHOT | Sorted unique account references | Repository contract only; no staff workflow |
| COLLECT_EXECUTIONS | Sorted unique account references and valid half-open range | Explicitly rejected until a result-event/persistence contract exists |

There are no mutation commands in protocol 1.0.

### Enqueue and idempotency

- Only staff in the agent organization can enqueue.
- The agent must advertise the command-specific capability.
- Issue time may be at most 30 seconds in the future, and a command cannot already be expired.
- Contract and database TTL are both at most ten minutes.
- A supplied expectedStateVersion must match the latest non-legacy complete snapshot.
- The (agent ID, idempotency key) pair is unique.
- The same semantic hash returns the original command/correlation/status; different intent conflicts.
- Command creation and agent.command_queued audit evidence commit atomically.

The semantic hash excludes retry-specific command/correlation IDs and timestamps. Callers must retain one idempotency key for one stable business intent.

### Polling, integrity, ordering, and leases

The dashboard poll handler implements the outbound-only contract: it authenticates the credential, expires overdue work, and selects queued work with row locks and SKIP LOCKED. The source companion polls outbound rather than accepting inbound VPS connections; deployment/network-policy proof remains pending.

Before delivery the repository reparses the stored command and recomputes payload, semantic, and envelope hashes. A mismatch is not delivered: the command becomes indeterminate and an agent.command_integrity_failed audit event is written.

Only the earliest nonterminal command for an agent is eligible, preserving per-agent command order. Each delivered entry contains:

~~~text
{
  envelope: {
    command: { ...strict protocol 1.0 command... },
    integrity: {
      canonicalization: RFC8785,
      payloadHash: sha256:...,
      semanticHash: sha256:...,
      envelopeHash: sha256:...
    }
  },
  leaseId: uuid,
  leaseExpiresAt: timestamp,
  deliveryAttempt: 1
}
~~~

Every attempt is stored with credential attribution and all four integrity fields. A lease lasts up to 30 seconds and never past command expiry. Leasing does not mark a command accepted. If the companion disappears, the command is eligible for redelivery after lease expiry; local execution must therefore be idempotent across retries and restarts.

### Expiry

Polling and staff command listing materialize overdue queued, accepted, started, or progress commands as expired and write agent.command_expired audit evidence. A new acknowledgement received at or after command expiry, or with occurredAt after expiry, is rejected. Expiry is terminal.

## Acknowledgements

An acknowledgement contains strict protocol/acknowledgement/command/correlation/agent/lease IDs, a positive command-local sequence, status, typed messageCode, typed evidence, evidenceHash, and occurredAt.

Evidence is not arbitrary JSON or free text. It contains allowlisted scopes/error codes, result event IDs, retry safety, an optional observed state version, and bounded counts. Each status has exactly one allowed message code.

| Current command status | Allowed next acknowledgement |
|---|---|
| queued | accepted, rejected, expired |
| accepted | started, progress, completed, failed, partial, expired, indeterminate |
| started or progress | progress, completed, failed, partial, expired, indeterminate |
| Terminal | None |

Terminal statuses are rejected, completed, failed, partial, expired, and indeterminate. Partial evidence must remain visibly partial and must never be presented as success.

The first acknowledgement must:

- use the latest delivery attempt;
- arrive while that lease is live;
- use the same credential that received the delivery;
- occur after issue and delivery and before command expiry.

That first acknowledgement binds the command to its lease, attempt, and delivery credential. Later acknowledgements must use the same bound lease/attempt and credential. They may continue after the 30-second delivery lease ends, but only before command expiry. Sequence must be last_ack_sequence + 1.

An exact acknowledgement-ID/full-hash replay returns the stored result without duplicating evidence, including when retried after expiry. A conflicting replay, unknown lease, stale/superseded first lease, changed bound lease, sequence gap, invalid transition, or late new acknowledgement is rejected.

Evidence insertion, command transition, sequence update, lease binding, and status-specific agent.command_* audit evidence commit atomically.

## Durable evidence and legacy quarantine

- agent_events retains event envelope, hashes, credential, times, and typed payload.
- Runtime identity tables preserve stable account and strategy bindings.
- Runtime observation tables tie sanitized account and strategy data to one complete snapshot.
- agent_commands retains semantic/payload/envelope hashes, expected state, expiry, status, delivery counters, bound lease, and acknowledgement cursor.
- command_deliveries retains every credential-attributed lease/attempt and delivered integrity fields.
- command_acknowledgements retains typed message/evidence, hashes, lease, credential, sequence, and times.
- audit_events summarizes enrollment, rotation, revocation, snapshots, queue, integrity failure, expiry, and acknowledgement transitions. Runtime, product, and portability repositories use the same canonical v1 audit writer: its SHA-256 hash binds event/tenant/entity metadata, a stable actor-subject snapshot, occurrence time, and optional origin installation. Only staged portability events currently supply origin.

Migration 0003 does not pretend legacy 0002 records had evidence they lacked. It:

- marks old events/commands/acknowledgements legacy_unverified;
- redacts legacy event payload and observation labels that may contain sensitive values;
- converts legacy commands and acknowledgements to indeterminate;
- excludes legacy snapshots from latest-state and expected-state decisions;
- writes explicit legacy-quarantine audit events;
- repairs invalid legacy TTLs before enforcing the ten-minute database constraint.

Migration 0005 likewise preserves pre-canonical audit history as `legacy_unverified` with a null evidence hash; it does not synthesize actor/time evidence that was never recorded. New canonical hashes provide content-bound evidence, not signatures, a database immutability guarantee, or an external append-only archive. Session lifecycle audit and full origin propagation are still absent.

Retention, export redaction, restore, tamper-evident archival, legal hold, and centralized alerting policies remain undefined.

## Error contract

| Code | HTTP | Meaning |
|---|---:|---|
| UNAUTHORIZED | 401 | Credential absent, invalid, expired, revoked, disabled, or incompatible |
| FORBIDDEN | 403 | Identity does not match the agent or resource |
| AGENT_NOT_FOUND, COMMAND_NOT_FOUND | 404 | Tenant-scoped resource absent |
| CONFLICT, SEQUENCE_STALE, SEQUENCE_GAP, INVALID_TRANSITION, INVALID_DELIVERY | 409 | Replay, ordering, state, integrity, or lease conflict |
| COMMAND_EXPIRED | 410 | Command expired |

Validation uses 400, oversized bodies 413, and unsupported content type 415. A 401 includes WWW-Authenticate: Bearer. Unknown failures return a generic INTERNAL_ERROR; stack traces and arbitrary exception text are not returned or logged by the API helper.

## Versioning

Protocol 1.0 objects are strict. Unknown fields, types, commands, and versions fail. Enrollment and authentication require exact stored compatibility. Do not silently transform strings, add defaults to hashed wire shapes, change field meaning, or weaken a safety invariant.

Breaking changes require a new version, published language-neutral vectors, migration/rollout order, replay tests, compatibility window, and retirement plan. Multi-version negotiation is not implemented.

## Required production work

### Shared dual-mode foundation

The repository now has explicit modes and capability/authority profiles, provider interfaces, stable/versioned portability records, atomic portable outbox staging, mode-aware shared UI, an exact `127.0.0.1` LOCAL_ONLY dashboard launcher with development/production socket evidence, schema-v2 per-mode build manifests bound to fresh Next.js `BUILD_ID` values, a recorded passing eight-test both-mode browser matrix, and initial read-only companion/local-IPC/Add-On source. The latter remains uninstalled and supervised-simulation only. Remaining production work is to:

- implement and select reviewed central/local identity, tenant-directory, secret-reference, notification, central-sync, storage, and runtime-transport providers;
- implement outbox delivery, inbox application, replay/gap behavior, domain conflict resolution, and audited attach/detach migration;
- compute dynamic effective capabilities from installed adapters, environment/account policy, safety phase, health, and kill-switch state;
- prove a complete LOCAL_ONLY cold start and supported workflow with central networking unavailable;
- define operational inbox cases for actionable failures and conflicts instead of silently dropping or retrying them forever;
- expand both-mode domain, adapter, authorization, recovery, and production-network suites before public networking or deployment.

### VPS companion

- Build a recoverable service with crash-safe event outbox and command journal.
- Persist event and acknowledgement sequences atomically with local work.
- Protect credentials with OS-backed storage and rotate without data loss.
- Enforce outbound HTTPS verification, bounded retry/backoff with jitter, clock synchronization, offline recovery, and dead-letter handling.
- Validate response schemas and make local execution idempotent across redelivery.
- Publish queue, credential, heartbeat, retry, partial, and dead-letter telemetry.
- Package, upgrade, roll back, and recover without implicit VPS/RDP/firewall/login-policy changes.

### Local IPC

Authenticated local IPC v1 now specifies same-user pipe ownership/ACLs, signed framing, correlation, payload limits, timeouts, clock/replay rejection, and typed errors. It is local-only and exposes no general remote-control port. Remaining production work is supervised installation, compatibility/upgrade policy, recovery/backpressure evidence, secret lifecycle, and Edith runtime acceptance.

### NinjaTrader Add-On

Use only documented NinjaTrader APIs. Branch source discovers accounts, connections, strategies, positions, orders, executions, and supported P&L, then the companion generates stable opaque references without exporting raw identifiers. Runtime-v2 remains sequential and explicitly partial; it must never claim a complete atomic snapshot. Before authoritative_read_only is authorized, the Add-On must be installed/recompiled, obey platform threading/lifecycle rules, survive reconnects, and pass supervised SIM comparisons for empty, duplicate, disconnected, stale, large, and partial-read cases.

Positions, orders, executions, reconciled P&L, post-action verification, SIM deployment, and risk enforcement require later gated work. No live action is authorized.

### Dashboard

Complete staff enrollment/rotation/revocation, expiry alerts, dynamic capability/environment policy, retention, rate limits, operational cases, and external-boundary evidence. The current runtime page and discovery action have automated browser/API/database evidence in CENTRAL_CONNECTED; that does not prove a companion, IPC, Add-On, or NinjaTrader outcome. Each feature remains gated by the corresponding automated and manual evidence in testing/control-evidence.md.
