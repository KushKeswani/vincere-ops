# NinjaTrader process control protocol 1.0

`process-control/1.0` defines two durable, manual-only commands: `LAUNCH_NINJATRADER` and `REQUEST_NINJATRADER_QUIT`. It is separate from read-only runtime protocol `1.0` and supervised strategy protocol `sim-control/1.0`. The LOCAL_ONLY dashboard now exposes both requests from the beginning, but it does not enroll an actuator: controls remain disabled until current server-side evidence passes, and the companion still ignores this queue unless its separate opt-in process-control block is enabled through supervised deployment.

The browser can submit only the authoritative runtime-discovery `install_*` reference selected from the companion's advertised installation allowlist; quit also binds the discovered `process_*` reference without translation. It cannot supply an executable path, working directory, arguments, credentials, environment variables, or shell text. The companion resolves the reference locally and fails closed when it is absent or ambiguous. An exact OS process match is necessary process evidence, but it is never sufficient proof that NinjaTrader or the Vincere Add-On is ready.

## Launch readiness gate

`LAUNCHED` and `ALREADY_RUNNING` require a strict `launchReadiness` observation from an authenticated Runtime-v2/Add-On IPC provider. The observation must be `ready`, at or newer than the exact OS post-observation, no later than the acknowledgement, and no more than five seconds old. A process ID, executable path, window, or elapsed start delay cannot manufacture readiness.

Provider absence, provider errors, invalid responses, unavailable Add-On state, future timestamps, and stale evidence fail closed with a typed non-sensitive reason. An OS process that was already running returns `attention_required / ALREADY_RUNNING_READINESS_UNCONFIRMED` with `actuatorInvoked=false`, `mutationMayHaveOccurred=false`, and `retrySafe=true`. A newly started OS process without proven readiness returns `attention_required / LAUNCHED_READINESS_UNCONFIRMED` with `actuatorInvoked=true`, `mutationMayHaveOccurred=true`, and `retrySafe=false`. Neither outcome authorizes an automatic retry or any trading action.

`WAITING_FOR_LOGIN` remains a compatibility outcome only when the post-process state is semantically identified as waiting for login and a fresh authenticated Add-On readiness observation reports literal `LOGIN_REQUIRED`. The Windows PID/path adapter never infers login state. No password is stored or entered.

The Windows adapter accepts an injected readiness provider, validates its bounded shape, and turns absence/error/invalid data into `unknown`. The opt-in companion process loop supplies that provider only from a fresh authenticated `GET_RUNTIME_OBSERVATION_V2` collection. Healthy connected authenticated Add-On evidence may satisfy launch readiness; unavailable, invalid, future, stale, incomplete, or unhealthy evidence remains unknown/not-ready and cannot complete launch readiness.

Quit intent also binds one authoritative `process_*` reference, a canonical process-state version, and a Runtime-v2 digest observed within 30 seconds. Its one-use interactive approval and the command both expire within 60 seconds. The browser-side summary is a non-actuating preview and must show:

- every schedule is disarmed;
- no evaluation, funded, live, or unknown account is present;
- no strategy is enabled or unknown;
- no position is open or unknown;
- no order is working, transitional, or unknown; and
- no mutation command is in flight or indeterminate.

The companion collects the separate `GET_MUTATION_READINESS_PREFLIGHT` response immediately before any possible graceful close. That v1 response requires two bounded consecutive keyed-digest samples, but reports `atomicity: not_guaranteed`; the domain's `permitsMutationActuation` gate therefore returns false and the current companion produces no executable quit runtime state. Graceful quit is intentionally blocked before actuation. A future protocol may proceed only after a supported NinjaTrader-wide atomic snapshot guarantee exists, the exact target/digest still matches, and all policy counts pass. Completion would then bind exactly one process observation and require a fresh authoritative stopped-state version and observation time. Force-kill, order cancellation, position flattening, connection disconnection, strategy mutation, implicit retries, and password automation are structurally absent or fixed to `false` in evidence.

Terminal outcomes are `completed`, `blocked`, `attention_required`, and `indeterminate`. Launch completion requires both timestamped exact OS state and the fresh authenticated Add-On readiness gate above; a real launch must change the process-state version, while the already-running no-op must preserve it. Blocked launch carries no post-state observation. A timeout, crash, or lost OS observation after actuation is `indeterminate`, has `mutationMayHaveOccurred=true`, is never retry-safe, and requires fresh discovery plus a new confirmation. `attention_required` prevents automatic actuation when OS state is known but Add-On readiness is not proven, when semantically proven login is required, or when a graceful quit could not be confirmed.

All delivered commands carry canonical payload, semantic, and envelope SHA-256 hashes using the runtime contract's RFC 8785 helper. Acknowledgements carry a separately verified evidence hash. These hashes provide integrity and intent binding; they are not authentication and do not replace the local companion enrollment and authorization boundary.

## Heartbeat process evidence

An enrollment configured for Runtime Observation v2 publishes process-only evidence in every authenticated `agent.heartbeat`. The companion observes only the exact allowlisted local-drive `NinjaTrader.exe` path through the Windows process adapter and maps it through the controller-owned process-reference and process-state-version derivations. The heartbeat and Runtime Observation v2 derive the same opaque `install_*` reference from one shared helper. Executable paths, process IDs, raw installation identifiers, and secret material are absent from the event, log, and doctor summary.

The strict local configuration block is:

```json
{
  "runtimeObservationV2": {
    "ninjaTraderExecutablePath": "C:\\Program Files\\NinjaTrader 8\\bin\\NinjaTrader.exe",
    "installationLocalId": "local-ninjatrader-default-installation",
    "freshnessMaxAgeMs": 5000
  }
}
```

The generated local installation ID is stable across agent credential rotation when the machine's identity secret is preserved, but never leaves the companion. Zero exact matches publish a fresh `not_running` state and state version, which is the prerequisite for a later approved launch. One exact match publishes an opaque `process_*` reference. Multiple or transitional matches publish `ambiguous` without a process reference. Any observation or validation failure publishes `unknown` with `OBSERVATION_FAILED`, a current safe timestamp, the same installation reference, and no invented state version. The enclosing heartbeat timestamp is always at or after the process observation timestamp.

Legacy configurations without `runtimeObservationV2` keep their existing v1 behavior and omit `processObservation`; retained server evidence expires by freshness policy instead of being replaced by invented data. Fresh enrollment advertises `process.observation` in addition to the existing read-only capabilities. It does not advertise `process.control`, launch, quit, strategy, order, or other actuation authority.

Source deployment does not alter Edith's existing `%LOCALAPPDATA%\Vincere\NinjaManager\companion.json`. A supervised migration still requires: stop only the companion; preserve the existing config, token, durable state/outbox, and logs; add the exact block above while preserving the existing `agentId` and secret-file references; add only `process.observation` to that agent's stored capability list; validate the strict config and privacy-safe doctor output; then start the companion and verify one authenticated heartbeat in the dashboard before enabling any process-control surface. A fresh enrollment receives the block automatically. The enrollment generator uses exclusive file creation and refuses to overwrite an existing config.

## Agent transport

Process control uses a separate authenticated agent transport and never shares the read-only command poll or acknowledgement endpoints. Both handlers derive the organization, agent, credential, and legacy enrollment protocol from `authenticateAgentRequest`; none of those identities are accepted from the JSON body. Every success and error response is `Cache-Control: no-store`, every request must be UTF-8 `application/json`, and every object is strict.

| Endpoint | Maximum body | Behavior |
| --- | ---: | --- |
| `POST /api/v1/agent/process-control/poll` | 1,024 bytes | Accepts exactly `{}` and calls `ProcessControlRepository.leaseNextCommand`; returns zero or one at-most-once process delivery under literal `process-control/1.0` |
| `POST /api/v1/agent/process-control/commands/{commandId}/acknowledgements` | 65,536 bytes | Parses a strict process acknowledgement, requires a UUID path ID equal to its body command ID, and calls `recordAcknowledgement` for the one terminal result |

The companion client exposes separately named `pollProcessControl` and `acknowledgeProcessControl` methods. Their schemas reject read-only protocol `1.0` command or acknowledgement objects, while the existing read-only client methods and wire paths remain unchanged. Process-control HTTP requests have a 65-second client bound, which is not shorter than the command's maximum 60-second approval and execution window. Process execution occurs after the poll response and before the acknowledgement request, so this HTTP timeout does not extend the absolute command, approval, lease, or acknowledgement expiry; the server still rejects a late acknowledgement.

This milestone remains `LOCAL_ONLY`. Local staff and the local client may create process approvals only when the local transport and queue capabilities are present. Central staff control is not authorized: a future expansion must require the client's explicit, scope-bound OTP support grant. This transport implements neither that grant nor any central authorization fallback.

## LOCAL_ONLY dashboard boundary

The browser submits exactly one `agentId`, `requestId`, `commandType`, and exact confirmation phrase (`LAUNCH NINJATRADER` or `QUIT NINJATRADER`). Next.js `$ACTION_*` metadata is ignored; every other field and every duplicate allowed field is rejected. The browser never submits installation/process references, process-state versions, Runtime-v2 digests, safety counts, paths, PIDs, account identifiers, or actuation details.

The server reselects the tenant-scoped agent, requires its advertised `process.control` capability, reads a fresh authenticated process heartbeat, and derives the target and expected process-state version. Graceful-quit preview additionally requires Runtime-v2 evidence no older than 30 seconds with strict `asOf <= event occurredAt <= server receivedAt <= current server time` chronology, complete process/Add-On scopes, narrowly usable sequential account/strategy/position/order scopes whose sole partial error is non-retryable `CAPABILITY_UNSUPPORTED`, a healthy connected authenticated Add-On, the exact same running process identity, simulation-only accounts, definitively disabled stable strategies, no positions, no working/transitional/unknown orders, and no queued/delivered/indeterminate process command. This is sufficient only to persist operator intent; it is not atomic mutation authority.

Only after those checks and the exact phrase does the action create a one-use approval and enqueue the approved command with request-scoped idempotency. It never calls the operating system. Repeating the same actor-bound request returns the original durable command; a key whose actor or command type differs is rejected.

## Opt-in companion execution

Process execution is absent unless the strict local companion config contains:

```json
{
  "processControl": {
    "enabled": true,
    "observationDelayMs": 500
  }
}
```

The block is rejected unless the same config also contains the strict `runtimeObservationV2` block. No existing config and no enrollment generator enables or emits `processControl`. Enabling it remains a separate supervised deployment decision.

The controller allowlist is derived locally from `runtimeObservationV2.ninjaTraderExecutablePath`, `runtimeObservationV2.installationLocalId`, and the 32-byte local identity secret. Neither a poll response nor a browser request can supply or replace the executable, local installation identity, arguments, working directory, environment, credentials, or shell text.

When opted in, the companion uses the exact-path Windows observation adapter, fresh Runtime-v2 collection for launch readiness, and the separate mutation-readiness collector for quit. Launch readiness requires a fresh complete Add-On scope with a healthy connected authenticated Add-On. Quit always returns no executable runtime state in this protocol version because `atomicity: not_guaranteed` cannot pass `permitsMutationActuation`; no ordinary sequential Runtime-v2 scope can substitute. Non-simulation or unknown accounts, enabled/unknown strategies, open positions, and working/transitional/unknown orders would remain blockers even after an atomic provider exists. The current companion has no scheduler actuator, so its local schedule count is zero; process control must not be enabled alongside a future scheduler until that scheduler supplies its durable armed-schedule authority to the same final preflight.

The durable process state machine is:

1. persist the exact delivery and the server deadline on first receipt;
2. persist the current companion process instance and execution attempt;
3. await a durable `actuationCommittedAt` marker immediately before either the exact-path launch or exact-process graceful-close call;
4. persist the exact terminal acknowledgement before posting it; and
5. clear the durable command only after the server accepts that acknowledgement.

An acknowledgement retry reuses the stored object byte-for-byte. A restart before the actuation marker may resume only when command, approval, and lease wall-clock deadlines all remain valid; its monotonic deadline is newly bounded by the remaining wall window. The original monotonic deadline is never extended within one companion process. A restart at or after the marker never calls the operating system again: it persists and posts one non-retryable indeterminate acknowledgement. An expired or failed pre-marker command remains fail-closed for manual reconciliation and blocks further process polling rather than being silently dropped. A durable process command never executes while a read-only command is active, and a pending process command prevents the companion from polling the read-only queue.

The controller API requires this awaited hook for every call and rejects omission before observation or actuation; there is no default or no-op production hook.

This source integration does not change active config/state, install or recompile the Add-On, start or stop any service/process, open network access, enable a schedule, mutate a trading connection/account/order/strategy, enter a password, force-kill NinjaTrader, or exercise the queue against Edith.
