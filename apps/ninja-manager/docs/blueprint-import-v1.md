# Blueprint XLSX Preview v1

## Scope and authority

`blueprint-preview/1.0` is a read-only preview boundary. It decodes one operator-supplied `.xlsx` workbook and returns normalized logical assignment candidates plus bounded warnings and errors. It does not persist, approve, map, schedule, enqueue, enable, disable, or otherwise act on NinjaTrader.

Workbook account values are logical labels only. They are never treated as NinjaTrader account references. A later, separately reviewed workflow must explicitly map each logical label to a fresh authoritative Add-On account reference and must preserve the product's supervised-SIM gates.

The compatibility source workbook at `Vincere/Automation/Vincere_Blueprint_2026-04-13.xlsx` remains read-only and outside the Ninja Manager runtime dependency graph. Tests may read it in place on Edith; they never modify or copy it and never log its cell values.

## Accepted workbook

- Basename ends exactly in `.xlsx` (case-insensitive); `.xls`, `.xlsm`, `.csv`, paths, and alternate extensions are rejected.
- Input is non-empty, no larger than 5 MiB, and starts with the exact XLSX ZIP signature `PK 03 04`.
- Before SheetJS decoding, central-directory metadata must describe a single-disk, non-encrypted, non-ZIP64 archive with at most 256 entries and at most 32 MiB total expanded content. This bounds decompression-bomb exposure.
- Only the exact `Cycling Blueprint` worksheet is selected for cell parsing. `Settings` and every other worksheet's cells are never read.
- Sheet metadata is inspected only to reject hidden/very-hidden sheets. Hidden target rows and merged cells in the used range are rejected.
- SheetJS formula evaluation is not used. Any formula or array-formula cell in the selected sheet is rejected even when it has a cached value. VBA payloads, dependency chains, embedded file data, and cells from unselected sheets are not loaded by the parser options.
- The worksheet is bounded to 500 data rows, 10,000 stored cells, 20 algorithm columns, and 2,000 normalized assignments. Results retain at most 100 warnings and 100 errors.

SheetJS Community Edition `0.20.3` is pinned directly to the official distribution tarball:

`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`

## Exact schema

Row 1 must contain this exact, ordered schema:

1. `Cycle Period`
2. `Account`
3. `Prop Firm`
4. `Stack Level`
5. contiguous `Algo 1` through `Algo N`, where `1 <= N <= 20`

Case, spelling, spacing, order, and column position are significant. Missing, ambiguous, duplicate, unsupported, or non-contiguous headers fail the preview. Data in a column without an accepted header also fails.

Each non-empty data row requires:

- `Cycle Period`: exactly `Period 1` or `Period 2`, normalized to `PERIOD_1` or `PERIOD_2`;
- `Account`: a bounded logical label using letters, numbers, spaces, `#`, and the documented safe punctuation set;
- `Prop Firm`: a bounded safe display label;
- `Stack Level`: exactly `N-Stack`, where `1 <= N <= 20`; and
- the first `N` algorithm slots populated contiguously as `NAME (INSTRUMENT)`.

An absent cell or exact `-` is an empty algorithm slot. Empty slots are allowed only after the declared stack. Declared `N-Stack` must equal the populated algorithm count. A duplicate normalized strategy/instrument pair in one row fails.

Strategy names use bounded ASCII identifier syntax. Instruments use bounded uppercase symbol syntax and are never substituted or inferred. The only v1 alias is the documented strategy rename `B2X -> RBO`; it emits a warning. No account, firm, strategy other than that alias, or instrument is silently changed.

## Preview evidence

An error-free result includes:

- the source basename and exact sheet name;
- SHA-256 of the original workbook bytes;
- a canonical semantic preview hash over version, sheet name, and normalized ordered assignments;
- data-row and assignment counts;
- logical account label, firm, normalized period, stack level, strategy, instrument, source row, and source slot; and
- bounded row/column warnings and errors whose messages never echo cell values.

If any error exists, `valid` is false, the canonical preview hash is null, and assignments/count are cleared. This prevents partially valid rows from becoming accidental control input.

## Verified compatibility on Edith

The read-only compatibility test observed the canonical workbook successfully with aggregate-only assertions: exact sheet name, 5 data rows, 16 assignments, 5 logical account labels, 1 firm, 2 periods, 6 strategy names, and 5 instruments. No workbook values are printed by the test.

## Local preview, mapping, and approval UI

The local Blueprint route exposes the parser through an authenticated and authorized Server Action. The action re-checks the `transport.local` deployment capability even when called directly, accepts exactly one standard XLSX `File` plus a request UUID, rejects duplicate or extra fields other than Next's `$ACTION_*` metadata, rejects unsafe basenames and MIME types, enforces the parser's 5 MiB limit before reading bytes, and returns a constrained display result with no workbook hash or account fingerprint. The raw Server Action body limit is 6 MiB only to accommodate the 5 MiB workbook plus multipart framing; the parser remains the file-size authority.

A valid preview renders aggregate counts, bounded warnings, and normalized assignments grouped by logical account and cycle period with their source row and algorithm slot. XLS, XLSM, and CSV are not advertised or accepted.

An error-free preview is staged server-side for 30 minutes. Workbook bytes, formulas, Settings cells, unselected worksheet cells, and raw cell values are never persisted or returned. Invalid previews are never staged. Request UUIDs are combined with the authenticated actor only on the server to derive repository idempotency keys.

Each logical workbook account begins unmapped and may be selected only from opaque account references backed by a fresh Runtime Observation v2 event for the selected owned local agent. The account and connection scopes must be usable for non-actuating sequential inventory: either complete with no errors, or partial with exactly one non-retryable `CAPABILITY_UNSUPPORTED` error that truthfully declares non-atomic collection. Any additional source/integrity error, unavailable scope, stale evidence, unauthenticated Add-On, or unclassified account locks mapping. This never promotes Runtime-v2 to complete or mutation-ready. The mapping action submits the staged preview reference, selected agent, request UUID, and one strict one-to-one mapping payload; the repository re-selects and revalidates the authoritative account and full strategy evidence.

A successful mapping creates an immutable draft. Approval is a separate Server Action that requires the exact phrase `APPROVE BLUEPRINT`, expected state version, and a new request UUID. It revalidates current Runtime-v2 evidence before appending the approved state. A page reload reads recent tenant-scoped revisions and renders only the revision reference/status/version, masked account identity, strategy, instrument, and logical assignment fields. Account refs, strategy refs, event refs, fingerprints, and hashes are never included in the browser revision projection.

Stages are actor-readable only. Revision reads and mutations require a bound agent whose environment belongs to the requesting client's user record; null, unbound, cross-tenant, and same-organization peer-client agents fail closed. Local staff access remains restricted to environment-bound agents. Central access remains denied pending scoped support grants.

Previewing, staging, drafting, and approval do not schedule, enqueue, enable, disable, connect, disconnect, place/cancel orders, or otherwise mutate NinjaTrader.

## Versioned assignment persistence

`blueprint-assignment/1.0` adds a server-only, local persistence boundary after the read-only parser. The Blueprint page now calls this boundary, while it remains separate from every control or scheduling path.

- Only a valid, non-empty `BlueprintPreviewResult` may be staged. The server stores its original workbook SHA-256, canonical semantic preview hash, normalized assignments, actor, and server timestamps; it never stores workbook bytes, the `Settings` worksheet, or cells from any unselected worksheet.
- A staged preview expires exactly 30 minutes after the server stages it. Its public read model includes the UUID preview reference, expiry, counts, and normalized assignments, but no workbook, request, content, binding, or runtime-state hash.
- Commit requires an explicit one-to-one mapping from every unique logical workbook account label to a different opaque Runtime-v2 account reference. Missing labels, extra labels, duplicate labels, reused accounts, and automatic or inferred mappings fail closed.
- The repository locks the authorized agent and selects its latest authenticated, canonical Runtime-v2 event itself. Callers cannot provide an event reference, digest, timestamp, classification, strategy reference, or connection result.
- Commit and approval require server age no greater than 30 seconds, valid `asOf <= occurred <= received <= server now` chronology, consistent declared age, healthy authenticated Add-On IPC, and the narrowly usable sequential account, connection, and strategy scope shape defined above.
- Every mapped account must be authoritatively classified by NinjaTrader as simulation, connected through present healthy known connection evidence, and unique in the revision. Every normalized strategy/instrument row must match exactly one stable current strategy instance on that account. One runtime strategy instance may be bound only once per revision. These checks authorize immutable assignment persistence only, never NinjaTrader actuation.
- Commit creates an immutable `assignment_rev_...` revision in `draft` state and binds account fingerprints, opaque account and strategy references, the source Runtime-v2 event/digest, and canonical hashes of the full runtime account/connection and strategy observations. It does not schedule or control anything.
- Approval requires the exact revision reference, expected draft version, and a new idempotency key. The server selects a new latest Runtime-v2 event and revalidates that all bound accounts, connections, and full strategy observations are unchanged. Approval appends state version 2; it never updates the draft row.
- Stage, revision, binding, and state tables are tenant-bound and append-only. All writes and audit evidence share one transaction. Reads recompute canonical content hashes so tampering remains detectable even if database-maintenance privileges bypass the mutation triggers.
- Local staff and local clients may use this repository boundary. `CENTRAL_CONNECTED` access fails closed for both roles until the client-issued, account- and scope-bound OTP support grant is implemented at this exact boundary.

This milestone exposes local-only Server Actions and page forms for stage, commit, and approval. It exposes no schedule, queue, enable, disable, launch, quit, order, cancel, flatten, connection, or NinjaTrader behavior. The active database is not migrated by source implementation or tests.

## Deferred work

CSV parity, schedule execution, and all control commands remain deferred. Weekly settings, authority, occurrence persistence, and audit transitions now exist, but no scheduler executor or NinjaTrader actuator consumes them. Those require their own authorization, audit, atomic preflight, and runtime-actuation review.
