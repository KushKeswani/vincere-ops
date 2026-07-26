# Mutation-readiness preflight v1

`GET_MUTATION_READINESS_PREFLIGHT` is a separate authenticated, read-only local IPC command for a just-in-time mutation gate. It does not mutate NinjaTrader, authorize a mutation, persist evidence, or change the deliberately partial semantics of sequential Runtime Observation v2.

The request payload is exactly `{}`. The Add-On returns only:

- a protocol/version marker and start/completion times;
- the disclosed consistency method `bounded_consecutive_stability`, `atomicity: not_guaranteed`, and sample count `2`;
- `ready` or `blocked`, with bounded reason codes;
- aggregate accounts, strategies, open positions, and working-order counts; and
- one HMAC-SHA256 digest over the underlying local state when both samples agree.

No account names, account numbers, local IDs, strategy names, instruments, process IDs, order IDs, credentials, or tokens cross the pipe. Local identity values are inputs only to the keyed digest.

## Fail-closed baseline

`ready` means only that two immediately consecutive bounded samples agreed and that the resulting baseline contains at least one account, only provider-classified simulation accounts, connected account sources, and no unknown strategy/position/order state. Enabled strategies, open positions, transitional orders, and working orders remain explicit counts for the eventual mutation-specific policy. A consumer must separately reject any count its intended mutation cannot safely tolerate. `ready` is never authorization by itself.

The response is wrapped by the companion collector as `mutation-readiness-preflight/1.0`, marked as authenticated local IPC evidence, and expires no more than five seconds after the Add-On completes collection. Invalid, stale, future-dated, malformed, unavailable, or blocked evidence must not reach actuation. The domain helper `permitsMutationActuation` deliberately returns `false` for this v1 contract: a process-command runner may collect and audit the evidence, but must not treat it as authority to actuate.

## Consistency limit

NinjaTrader does not expose a documented transaction spanning `Account.All` and every account's strategies, positions, and orders. The Add-On therefore does **not** claim database-style atomicity. It takes two consecutive bounded samples, computes a keyed digest over each full state, and emits a summary only when the digests match. This closes the prior contract gap by providing one short-lived internally consistent summary from one authenticated command, but a state could theoretically change and return to the same value between reads. Until a documented NinjaTrader-wide snapshot primitive exists, every mutation consumer must keep a final local fail-closed policy and invoke this command immediately before actuation.

The source-level Windows offline probe compiles the Add-On against the installed NinjaTrader assemblies and verifies that the command remains authenticated/read-only, uses a dedicated aggregate summary, discloses consecutive-stability semantics, fails closed on sample disagreement, and does not add identity fields to its DTO. It does not load, install, contact, or recompile the running NinjaTrader process.
