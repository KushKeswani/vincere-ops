# Architecture

## One product, two deployment modes

Ninja Manager is one product with shared domain rules and shared UI. It must support two explicit deployment modes without source forks:

- **CENTRAL_CONNECTED**: the target hosted dashboard is the client/staff control plane; a future VPS companion will make outbound-only authenticated connections to it.
- **LOCAL_ONLY**: the target local installation uses the same product with local identity, storage, secret, notification, and transport adapters and no required cloud dependency.

The portability foundation is implemented without a fork: deployment mode is explicit, installation mode is persisted, capability and authority profiles select mode-aware identity/navigation/action policy, adapter ports define the external boundaries, migration 0004 provides versioned portable-record/outbox/inbox/conflict/secret-reference metadata, and migration 0005 hardens canonical audit evidence and product mutation idempotency. CENTRAL_CONNECTED and LOCAL_ONLY browser projects exercise the same application code.

This foundation is not a production adapter stack. Managed/local identity providers, MFA and recent re-authentication, secret retrieval, notification delivery, central synchronization transport, inbox application, conflict resolution, and the cross-mode operational inbox remain deferred.

The separate Vincere/Automation project is read-only reference material for reusable operator/Add-On foundations. Any reused behavior must be consolidated into Ninja Manager's companion or Add-On; Automation is not a runtime dependency and must not become a third control plane.

## Product boundary

The diagram below is the required product topology, not a claim that the companion, IPC, Add-On, local storage, or operational-case adapters already run.

~~~text
                         Shared domain rules and shared role-aware UI
                                        |
               +------------------------+------------------------+
               |                                                 |
       CENTRAL_CONNECTED                                    LOCAL_ONLY
       central identity                                    local identity
       central directory                                   local directory
       managed PostgreSQL                                  local durable store
       central cases/audit                                 local cases/audit
               |                                                 |
       central-sync adapter: ON                         central-sync adapter: OFF
               |                                                 |
       outbound-only companion                         local IPC (target; pending)
               +------------------------+------------------------+
                                        |
                            in-process NinjaTrader Add-On
                         authoritative for NinjaTrader state
~~~

The companion is a durability and transport boundary, not an alternate source of NinjaTrader truth. The future in-process Add-On is the only component permitted to use documented NinjaTrader APIs and produce reviewed authoritative runtime observations.

No production-packaged companion or deployed NinjaTrader Add-On exists yet. A read-only companion, authenticated local IPC v1, secure per-user setup scripts, Runtime-v2/process-control source integration, and Add-On source exist under a supervised-simulation authority label. They have not been installed/recompiled or reconciled inside NinjaTrader. The managed dashboard HTTP listener remains distinct from Add-On IPC. Production packaging, credential lifecycle, recovery monitoring, controlled mode migration, and authoritative-read promotion do not exist.

## Shared core and required mode adapters

The shared core is the owner of:

- domain types and validation;
- stable record IDs and record versions;
- role/capability authorization decisions;
- assignment preview/validation/approval rules;
- runtime command/event/acknowledgement contracts;
- conflict classification;
- audit event vocabulary;
- operational-case state machine;
- shared accessible UI components and route intent.

The current foundation implements the mode/capability/authority contracts, adapter interfaces, portable sync envelope, conflict vocabulary, audit vocabulary, mode-aware authorization/navigation, and shared UI route intent. CSV assignment preview/approval rules and the operational-case state machine are later phases.

Required mode-specific behavior must be behind explicit adapters:

| Adapter | CENTRAL_CONNECTED | LOCAL_ONLY |
|---|---|---|
| Identity | Central user/session provider | Approved local identity and re-authentication provider |
| Tenant directory | Organization-scoped central directory | Local workspace/directory |
| Secrets | Managed secret-reference provider; no value in domain records | OS-backed local secret-reference provider; no value in domain records |
| Notifications | Central notification provider after approval | Local notification provider or an explicit unavailable capability |
| Central synchronization | Durable outbox/inbox transport | Disabled; domain operations must continue without it |
| Runtime transport | Dashboard-side agent API/queue now; outbound companion and Add-On IPC are targets | Exact loopback dashboard listener now; authenticated local Add-On IPC is a target |
| Storage | Managed PostgreSQL | Approved local durable database with backup/recovery policy |

`src/lib/deployment/ports.ts` now defines portable interfaces for identity, tenant directory, secrets, notifications, central sync, and runtime transport. These are boundary contracts, not claims that production providers have been selected or integrated. In particular, the LOCAL_ONLY transport capability describes policy for a future provider; it is not evidence of local IPC or an Add-On. Storage remains outside the current port set and still needs a reviewed central/local abstraction.

An adapter returning “not configured” is not permission to render a dead control. Route and navigation availability must derive from mode plus capability flags. LOCAL_ONLY must neither render central-only actions nor emit background requests to central services.

## Deployment mode and capability policy

`NINJA_MANAGER_MODE` selects exactly CENTRAL_CONNECTED or LOCAL_ONLY at deploy/runtime. Production fails closed when the variable is missing or invalid. `product_installations` persists the installation kind, mode, enrollment state, stable installation ID, record version, and next outbox sequence. Mode is not exposed as a casual settings toggle; the explicit re-authenticated, audited migration procedure remains unimplemented.

Mode alone is insufficient. Effective capabilities must be computed from:

- deployment mode;
- authenticated principal and role;
- tenant/workspace scope;
- installed adapter capabilities;
- enrolled companion/Add-On capabilities;
- environment/account policy;
- safety phase, such as supervised simulation or approved SIM-only;
- current health, staleness, and kill-switch state.

Unknown modes fail closed, and static route/action availability derives from the selected profile plus role. The current runtime repository additionally checks tenant, advertised command capability, expected state, health/staleness, and dry-run command type. Composing installed-adapter, environment/account, safety-phase, and health signals into one dynamic effective-capability decision remains future work.

## Authority matrix

The mode profiles implement the writer and conflict-policy baseline for this authority model. “Authoritative” identifies where a decision is created and changed; projections may be cached elsewhere but cannot silently overwrite their authority.

| Record or decision | CENTRAL_CONNECTED authority | LOCAL_ONLY authority | Synchronization/conflict rule |
|---|---|---|---|
| User identity and tenant/workspace membership | Central identity and organization directory | Local identity and workspace directory | Identity records are not merged across modes; an explicit enrollment/migration maps stable principals |
| Client directory | Central PostgreSQL client directory | Local durable client directory | Central mode may send least-privilege versioned projections to a companion; local-only records do not sync unless an explicit, audited migration is initiated |
| Account-to-client and strategy assignments | Approved central assignment version | Approved local assignment version | Draft/preview never becomes authority; stale base version or concurrent approval creates a conflict case, never last-writer-wins |
| Strategy configuration approval | Central staff approval record | Local authorized approval record | Approval IDs and versions are immutable; execution requires the exact approved version |
| NinjaTrader accounts, strategies, positions, orders, executions, and P&L observations | Target after Gate 4: in-process Add-On, reported through the companion; no current authoritative source | Target after Gate 4: in-process Add-On, reported locally; no current authoritative source | Dashboard records are timestamped observations. User-entered labels and central cache are never authoritative runtime state |
| Runtime command intent | Central staff control plane within allowed phase/capability | Local authorized operator within allowed phase/capability | Stable command/idempotency IDs, expiry, expected state, and post-action evidence are mandatory |
| Operational inbox cases | Central case store; local failures may originate as versioned case events | Local case store | Create/update by idempotency key and record version; conflicting transitions produce a conflict case |
| Audit evidence | Target: append-only at the authority where the action occurred; central store aggregates central and synced local evidence | Target: append-only local store | Target rule (unimplemented): sync copies evidence and never rewrites origin evidence. Gaps, redaction failures, and replay conflicts become cases |
| Secret values | External managed vault/OS store; domain stores references only | OS-backed local store; domain stores references only | Secret values never synchronize through ordinary records, audit, logs, screenshots, or support exports |
| Notification delivery | Central notification adapter | Local adapter if configured | Delivery is non-authoritative. Failure creates a case or retry record; it cannot roll back the business decision |

The current schema implements central client/configuration/incident/audit records, runtime observation/queue evidence, dual-mode installation and authority metadata, portable record state, durable outbox/inbox/conflict tables, secret references, and origin/version/hash audit fields. New repository audit writes use a shared canonical v1 hash, but the database is not an external append-only archive. Only staged portability events currently carry origin installation IDs; ordinary product and runtime audit rows do not. The schema does not yet map every business-domain record into portable state, implement CSV assignment versions, deliver central projections, apply inbox messages, resolve conflicts, or implement the operational case model in this matrix.

## Versioned local records and synchronization

Every record that may cross a mode boundary requires:

- a stable globally unique record ID;
- organization/workspace ID and origin installation ID;
- schema version and monotonic record version;
- created/updated actor and time;
- idempotency key for the originating operation;
- tombstone rather than silent deletion where replication matters;
- redacted audit reference;
- explicit synchronization state.

CENTRAL_CONNECTED requires a crash-safe local outbox and inbox. A local transaction must atomically commit the business record, audit event, and outbox entry. Inbox processing must be idempotent and retain source sequence/version. Acknowledging transport receipt is not the same as accepting a business transition.

Conflict handling must be domain-specific:

- identical ID/version/content is an exact replay;
- a stale base version is rejected and surfaced;
- concurrent assignment or approval changes never use last-write-wins;
- immutable audit, command, acknowledgement, and runtime evidence is never edited in place;
- resolvable projection lag may retry with bounds;
- non-resolvable conflicts create an operational inbox case with both evidence references.

LOCAL_ONLY must use the same IDs, versions, audit vocabulary, and case rules even while synchronization is disabled. That keeps future audited migration possible without making cloud availability a local prerequisite.

Migration 0004 and the v1 sync contract implement the durable record shapes, stable installation/record/message IDs, versions, tombstone operation, authority, sequence, content/envelope hashes, sync states, inbox receipt/business states, and conflict vocabulary. `PortabilityRepository.stageChange` atomically commits portable record state, a sequenced outbox envelope, and origin-aware audit evidence; a stale base version rolls back the claimed sequence. LOCAL_ONLY derives local authority and marks record state local-only while retaining portable evidence for a later explicit enrollment.

No central sync transport, outbox lease/delivery worker, inbox processor, replay/gap workflow, conflict resolver, or migration orchestration is implemented. The inbox and conflict tables are durable seams, not evidence that synchronization has run.

## Operational inbox cases

The product needs one operational inbox for actionable work, not separate untracked failure surfaces. A case should have stable ID, tenant/workspace, type, severity, state, owner, source evidence references, deduplication key, record version, timestamps, resolution, and audit history.

Cases should cover at least:

- assignment validation or approval conflict;
- companion offline/stale or credential expiry;
- sequence gap, dead letter, or synchronization conflict;
- partial/indeterminate command result;
- authoritative snapshot mismatch;
- notification failure that needs human action;
- secret-reference unavailable or rotation overdue;
- P&L reconciliation mismatch in a later phase.

Existing incidents support a guided simulated VPS-failure workflow. They are not yet the cross-mode operational inbox described here.

## Security and secret handling

### Browser sessions

The current central browser receives a random HTTP-only, same-site session token. The database stores its SHA-256 hash with an eight-hour expiry. Passwords use bcrypt cost 12. Role, organization, and resource ownership are re-evaluated server-side.

LOCAL_ONLY currently uses the shared database-backed session implementation with a client-only role policy; staff identities are rejected in that mode. A production local identity provider, MFA readiness, lockout, recovery, and recent re-authentication for sensitive actions are not selected or implemented.

### Companion identity

The implemented dashboard-side agent API boundary uses a hashed, expiring, rotatable, revocable bearer credential. Tenant and agent identity are derived from the credential. The source companion polls outbound and may access only its own event, command-delivery, and acknowledgement paths; production deployment/recovery and supervised Edith evidence remain pending.

Production still requires verified TLS termination, secure one-time credential delivery, OS-backed storage, rate limiting, and a decision on request signing/mTLS. No inbound VPS listener is authorized.

### Secret references

Domain records must store opaque secret references and safe metadata, never secret values. Revealing, replacing, exporting, or testing a secret reference requires:

- explicit authorization;
- recent re-authentication;
- least-privilege retrieval from the mode adapter;
- redacted success/failure audit evidence;
- no value in React props, URL, logs, case text, synchronization payload, screenshots, or notification body.

The current runtime token is returned once on enrollment/rotation and only its hash/final four are stored. Complete staff delivery/re-authentication workflows and generic secret-reference adapters are not implemented.

## Current implementation decisions

### Deployment portability seams

- `src/lib/deployment/contracts.ts` defines strict modes, capability maps, allowed roles, runtime transport kind, connectivity direction, and per-mode authority rules.
- `src/lib/deployment/configuration.mjs`, `server.ts`, and the managed Next.js launcher resolve deploy/runtime configuration, fail closed in production, reject every hostname CLI form, require the LOCAL_ONLY APP_URL to use `127.0.0.1` and the configured port, and bind the LOCAL_ONLY dashboard listener to exactly `127.0.0.1`.
- The build launcher creates separate CENTRAL_CONNECTED and LOCAL_ONLY output directories and atomically writes a schema-v2 manifest tied to the mode, directory, build time, and fresh Next.js `BUILD_ID`; production start rejects a missing, malformed, mode/output-mismatched, or `BUILD_ID`-mismatched artifact.
- `src/lib/deployment/navigation.ts`, session authorization, route actions, and shared pages consume the profile instead of duplicating applications.
- `src/lib/deployment/ports.ts` isolates identity, tenant directory, secret-reference, notification, central-sync, and runtime-transport providers.
- `src/lib/domain/sync-contracts.ts` defines strict, RFC 8785 content-bound portability envelopes that carry references and hashes rather than domain or secret payloads.
- `migrations/0004_deployment_portability.sql` and `PortabilityRepository` provide the durable installation/record/outbox/inbox/conflict/secret/audit foundation and atomic outbox staging. This is a portable staging seam; business-domain sync mapping, delivery, and application are pending.
- `migrations/0005_foundation_integrity.sql`, the shared audit writer, and the product repository provide canonical v1 audit evidence plus atomic idempotency for all ten product mutation scopes. Legacy audit rows remain explicitly unverified.
- Playwright runs the same application as CENTRAL_CONNECTED and LOCAL_ONLY, including mode-specific roles, navigation, permissions, offline/same-origin behavior, accessibility checks, real development-listener inspection, and four responsive widths. A separate production-start socket gate verifies the built LOCAL_ONLY artifact.

Concrete provider adapters, synchronization delivery/application, operational cases, and controlled attach/detach migration remain separate gated work.

### Next.js App Router

Server Components keep database reads off the browser. Server Actions handle first-party forms and re-authorize mutations. Route handlers provide typed integration-facing APIs.

### PostgreSQL system of record

The schema models organizations, users, sessions, clients, trading accounts, environments, approved strategies, versioned configurations, approvals, health checks, incidents, audit events, runtime credentials, ordered events, complete observations, commands, delivery leases, acknowledgements, idempotency evidence, product installations, portable record state, sync staging, conflict evidence, and secret references.

PGlite provides embedded PostgreSQL semantics for development and automated tests. Production configuration currently rejects PGlite, requires a PostgreSQL URL, and requires sslmode=verify-full in both modes. That is not a selected production LOCAL_ONLY storage adapter. A real managed PostgreSQL concurrency/TLS suite has not run in this workspace.

The migration runner records SHA-256 checksums and refuses a changed or missing applied file and a legacy filename-only ledger without an explicitly trusted baseline. All 15 migrations landed through P4 and both mode-specific fixture passes are verified on fresh PGlite stores. Cross-process/global migration locking and execution against managed PostgreSQL remain pending.

### Deterministic strategy recommendation

The MVP selects only from approved catalog entries and generates bounded configuration values. It does not let a language model invent risk parameters. A version cannot become approved without staff authorization.

### Simulated connectors and runtime protocol

OperationsConnector remains a simulated health boundary for NinjaTrader, VPS, Discord, GHL, and n8n. The runtime protocol provides the dashboard-side agent API and durable queues consumed by the source companion; authenticated local IPC and Add-On source provide the local read-only boundary. Protocol 1.0 has no trading mutation commands, and current authority remains supervised simulation until installation and Edith reconciliation. Separate process-control source exists but is opt-in, undeployed, and unable to actuate graceful quit because its preflight truthfully reports non-atomic evidence.

### Auditable safety controls

All ten product mutation scopes (client creation, onboarding, client access, account/environment registration, recommendation, approval decision, deployment recording, health-failure simulation, incident transition, and organization kill switch) use one transaction for the business change, a completed idempotency result, and audit evidence. The idempotency hash binds schema, scope, organization, actor-subject snapshot, and canonical input; exact retries replay the stored result and changed intent conflicts. Conditional `UPDATE ... RETURNING` transitions make approval decisions concurrency-safe and reject stale incident decisions.

Product, portability, and runtime repositories use the shared canonical v1 audit writer. Its SHA-256 evidence binds the event ID/version, organization, stable actor-subject snapshot, action, entity, metadata, optional origin installation, and occurrence time; the same occurrence time is stored with the row. Changing the actor/time snapshot invalidates the recorded hash, but no trigger prevents a database writer from replacing a row and hash. Pre-0005 audit rows are preserved as `legacy_unverified` with a null evidence hash rather than being retroactively trusted. Only staged portability events currently carry origin; ordinary product and runtime audit rows do not. Browser session creation/deletion is not audited, and no external append-only archive, retention, or legal-hold provider is implemented. The kill switch remains an application control and is not connected to an external trading system.

## Authorization rules currently enforced

- Clients can access only the client linked to their user inside their organization.
- Staff can manage records only inside their organization.
- Clients cannot supply another client ID for health simulation.
- Approvals require staff role and matching organization.
- Deployment can be recorded only for the signed-in client's approved configuration.
- Browser API mutations require a matching request origin where implemented.
- Agent routes require a valid bearer credential; tenant identity comes from it.
- Runtime event and acknowledgement sequences are contiguous.
- The first acknowledgement binds to the latest live credential-attributed delivery lease.

## Data minimization

The dashboard stores masked account identifiers, opaque references, keyed fingerprints, allowlisted operational fields, and typed evidence—not brokerage passwords or raw account credentials. Latest runtime inventory excludes legacy-unverified snapshots.

Migration 0003 quarantines and redacts legacy runtime evidence that lacked the current integrity/typing guarantees rather than presenting it as verified.

See runtime-protocol-v1.md for exact implemented contracts and testing/control-evidence.md for automated evidence and open gates.
