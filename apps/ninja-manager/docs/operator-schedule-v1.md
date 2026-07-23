# Operator weekly schedule v1

`operator-schedule/1.0` is a domain contract, not a scheduler or trading actuator. It defines the only weekly schedule that may later issue exact supervised-SIM commands through the durable companion queue.

## Defaults and authority

- All wall-clock settings use `America/New_York`, so the defaults follow Eastern daylight-saving changes: reconcile/enable at 08:30, capture EOD at 17:00, and stop Friday at 18:00.
- One explicit arm grants enable authority for one Monday-through-Friday week. It binds one settings revision, one assignment revision, and a sorted set of opaque simulation account/strategy references.
- Authority expires at Friday 18:00 before stop processing. It never renews itself. The following week needs a new authority record.
- Any settings edit creates a new revision. An authority for an older settings or assignment revision is invalid and must not be migrated or silently re-armed.
- Arming during a week does not catch up earlier occurrences. Those occurrences receive a stable key and `skipped / ARMED_AFTER_DUE` evidence.

The v1 settings schema allows a sorted subset of weekdays but never weekends. It requires `enable < EOD < Friday stop`. The time zone, renewal policy, missed policies, and DST policy are fixed safety invariants rather than caller-selected modes.

## Occurrences and restart behavior

Materialization produces exact, deterministic occurrence keys from schedule, authority, settings revision, assignment revision, target binding, local date/time, and action. Re-materializing after a process restart produces the same keys, so storage must enforce uniqueness by `occurrenceKey` and must resume existing state instead of inserting duplicate work.

Each selected weekday has:

1. `RECONCILE_AND_ENABLE_SIM_STACK`
2. `CAPTURE_EOD_SNAPSHOT`

Friday 18:00 has three occurrences sharing the instant and ordered by `fridaySequence`:

1. `REVOKE_ENABLE_AUTHORITY` — local durable revocation; it does not depend on NinjaTrader availability.
2. `DISABLE_EXACT_SIM_STACK` — exact targets only; blocked until revocation is recorded.
3. `DISARM_WEEKLY_SCHEDULE` — blocked until the exact disable has verified post-state.

Allowed statuses are `planned`, `due`, `leased`, `completed`, `skipped`, `failed`, `indeterminate`, `latched`, and `superseded`. Terminal failure and indeterminate states are not automatically retryable. A restart may rematerialize and classify, but may not reset terminal state or lease duplicate work.

## Missed and latch policies

- Enable has a five-minute due window. After it closes, it is missed and skipped; it is never caught up or automatically retried.
- EOD may run once late on the same Eastern calendar day. Friday EOD closes at the 18:00 stop boundary. Older EOD work is missed, not backfilled by the scheduler.
- Friday revocation remains due until durably recorded. Exact disable and disarm remain blocked/latched until verified in order; lateness never restores enable authority.
- Stale runtime state, Add-On loss, connection loss, ambiguous targets, any non-SIM classification, assignment/settings drift, an indeterminate mutation, or an operator pause latches scheduled runtime work. Clearing a latch only permits a fresh evaluation; it does not imply a retry of a terminal or potentially-mutated command.

Custom wall times that are nonexistent or ambiguous during an Eastern DST transition are rejected with `NONEXISTENT_LOCAL_TIME` or `AMBIGUOUS_LOCAL_TIME`. The contract never guesses an offset.

## Integration boundary

Persistence and execution layers must store the settings revision, weekly authority, occurrence key/status, and audit transitions. Before leasing a mutation they must run the safety evaluation against fresh authoritative NinjaTrader state. Scheduled strategy commands must retain their own short TTL, idempotency, exact expected state, and verified before/after evidence from `sim-control/1.0`; this schedule contract does not weaken those controls.
