# EOD snapshot v1

## Scope

EOD snapshot v1 is an immutable, repository-level capture of a previously authenticated `runtime.observation_v2` event. It adds persistence and read contracts only. It does not expose an HTTP endpoint, schedule a capture, contact NinjaTrader, or perform a trading or process-control action.

The v1 operating calendar is fixed to `America/New_York`. The repository derives the intended local date from its server capture timestamp using that DST-aware zone. There is no caller-selected time zone, date, or backfill path.

## Source-of-truth boundary

A caller supplies only:

- the exact enrolled agent UUID;
- the exact runtime event UUID already stored by the server;
- a 16–200 character idempotency key;

The repository reads the source payload server-side. It accepts the event only when all of these conditions hold:

- the agent and event belong to the caller's tenant and the event belongs to that exact agent;
- the stored event is non-legacy authenticated evidence with a credential composite-bound to the exact tenant and agent and a canonical envelope hash;
- the event parses as `runtime.observation_v2` and its payload hash, envelope hash, and state digest all verify;
- timestamps satisfy `asOf <= occurredAt <= receivedAt <= capturedAt`;
- declared freshness is `fresh`, actual server age at capture is no more than 45 seconds, and declared age agrees with `occurredAt - asOf` within the fixed two-second tolerance;
- every P&L observation containing at least one available value has a session date equal to the intended EOD local date.

Stale, future, tampered, legacy, non-v2, cross-tenant, and wrong-agent evidence fails closed. No fallback to a v1 snapshot exists.

## Persisted evidence

The immutable snapshot header binds:

- source event UUID, sequence, state digest, `asOf`, event `occurredAt`, and server `receivedAt`;
- server `capturedAt`, intended local date, and time zone;
- the source's explicit overall collection completeness;
- the actor-bound idempotency key and canonical resolved-request hash.

All nine source collection scopes are copied with their exact `complete`, `partial`, or `unavailable` status, item count, typed error codes, and retryability. This keeps missing evidence visible.

Each account is assigned a new snapshot-local ordinal. Stored account fields are limited to:

- masked identifier and safe display label;
- authoritative simulation/live classification, or explicit unavailable classification and reason;
- optional P&L evidence;
- the current safe strategy-stack display fields.

For each observed P&L account, five values are stored: daily realized, daily unrealized, daily total, native lifetime, and manager-observed cumulative. Every value retains availability, USD value when available, source when available, and reason when unavailable. Manager cumulative evidence also retains its required `observedSince` timestamp and therefore cannot be presented as native lifetime P&L. Metric-specific source constraints and daily realized-plus-unrealized arithmetic are enforced in the domain contract, repository read verification, and SQL. Available zero remains `amountMinor: 0`; unavailable remains `amountMinor: null` and can never be represented as zero.

Strategy rows retain only snapshot-local ordering, display label, strategy type, instrument, enabled flag, runtime state, and synchronization state.

The snapshot never stores account fingerprints, source account references, source strategy references, process IDs, credentials, tokens, or secrets. Runtime references are used only in memory to associate validated source objects with snapshot-local account rows.

## Authorization and idempotency

This milestone is intentionally `LOCAL_ONLY`. Local staff and local client sessions may capture and read tenant-owned snapshots. Both roles are denied in `CENTRAL_CONNECTED` until client-issued, scope-bound OTP support grants are implemented at this repository boundary.

Idempotency keys are unique per tenant and bound to the creating user. Repeating the same key with the exact resolved request returns the original snapshot with `duplicate: true`. A different request conflicts, and a different actor is forbidden. Snapshot creation, child evidence, idempotency state, and canonical audit evidence commit in one database transaction; an audit-write failure rolls back the capture.

Every transformed snapshot has a canonical `contentHash` computed over the full public snapshot except the hash field itself: source provenance, calendar data, all nine scopes, accounts, P&L values and observation windows, and strategy stacks. The hash is included in canonical audit metadata and recomputed on capture return, idempotent replay, `getSnapshot`, and every item read by `listSnapshots`. Valid-shape header or child-row changes therefore fail closed.

All five EOD tables reject SQL `UPDATE` and `DELETE`. Agent deletion is restricted while retained EOD evidence exists. A legal tenant deletion consequently requires separately authorized, audited database maintenance: preserve or export required evidence, record the maintenance authority and scope, temporarily manage the append-only guards inside the controlled deletion transaction, and restore and verify the guards afterward. No application endpoint bypasses retention.

## Read bounds

`getSnapshot` is tenant-scoped by snapshot UUID. `listSnapshots` is tenant-scoped, optionally agent-scoped, newest-first, defaults to 50 rows, and accepts at most 100 rows. List reads intentionally verify each full bounded snapshot before returning its summary. The full capture is bounded by the runtime-v2 contract: at most 500 accounts and 10,000 strategies.

## Local Day ops UI

The /client/activity Day ops page exposes manual capture and readout only in LOCAL_ONLY. The Server Action re-authenticates the client session and rechecks transport.local; central mode never invokes the Runtime or EOD repositories and instead explains that client-issued, session-scoped OTP support access is deferred.

The browser submits only an authorized installation UUID and a one-time UUID request key. It cannot select the source event, date, time zone, P&L, stack, or snapshot content. The action reads the latest authenticated runtime.observation_v2 event for that tenant-owned installation on the server and passes its exact event UUID to captureManualSnapshot. The page uses the same 45-second chronology/freshness policy only to disable an obviously unready button; the repository remains authoritative and repeats every source, freshness, date, integrity, authorization, and idempotency check at capture time.

The readout shows the intended America/New_York date, capture time, overall and per-scope completeness, masked account label and identifier, authoritative or unavailable classification, daily realized/unrealized/total P&L, native lifetime P&L, manager-observed cumulative P&L with its observation start, and the exact retained strategy stack. Available zero is explicitly labeled and unavailable values retain a safe reason. Partial or unavailable collections warn that absence is not proof that no account or strategy exists. Event IDs, hashes, fingerprints, opaque runtime references, process IDs, credentials, database details, and full account identifiers are never rendered.

The manual capture path does not contact NinjaTrader, schedule work, or enqueue any runtime, process, strategy, order, connection, launch, or quit command. Successful capture revalidates /client/activity so the immutable latest snapshot and bounded history are rendered in the same action round trip.

## Deferred work

Scheduled weekday 17:00 ET capture, durable companion orchestration, OTP support grants, and runtime installation/verification are separate milestones. None are authorized or implied by this source-only manual UI.
