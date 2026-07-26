# NinjaTrader Add-On runtime observation v2

## Status and boundary

GET_RUNTIME_OBSERVATION_V2 is an additive authenticated local-pipe command. Existing framing, authentication, PING, and GET_RUNTIME_SNAPSHOT payloads are unchanged; GET_CAPABILITIES adds only the new read-only command. No trading, order, strategy, connection, process, configuration, or credential mutation is added.

The response protocol is ninjatrader-addon-snapshot/2.0. The Add-On emits only Add-On-owned evidence:

- observedAt
- Add-On health and read-only capabilities
- connections, accounts, strategies, current non-flat positions, current and bounded historical orders, bounded executions, and account-item P&L
- per-scope collection status and typed errors

Process/install/session identifiers, companion receipt time, freshness policy, manager cumulative P&L, item counts, and overall collection status remain companion-owned and are not emitted.

The companion's process observation is privacy-separated from the Add-On snapshot. An exact running `NinjaTrader.exe` match is represented only by the same controller-owned HMAC `processRef` used by process-control heartbeat evidence; the configured path and Windows PID never enter the Runtime-v2 event, doctor summary, or logs. An exact zero-match observation is reported as `not_running` with no retained process identity. Multiple matches, transitional states, invalid timestamps, and provider failures remain unavailable with typed error evidence. The controller-owned installation-reference and process-state-version derivations validate the observation before it is mapped, while the process state version continues to travel in its existing heartbeat contract rather than being duplicated in Runtime-v2.

## Authority and identity

- Account localId and accountIdentifier are the exact account name already used by v1. They remain inside the authenticated local IPC boundary.
- Strategy localId reuses the exact v1 composite and sorted occurrence algorithm, including the full type name in that composite. The separately emitted strategyTypeCode reproduces the v1 companion normalization exactly: final segment after the last dot, unsupported characters replaced with underscores, and Strategy_ prefixed when the first character is not an ASCII letter. Oversize or still-invalid results are omitted with a typed partial strategy scope.
- Account names are never used to infer simulation status.
- Account.Provider is the only account-specific classification evidence used. Simulator or Playback is positive authoritative simulation evidence. Every other provider remains unknown with CLASSIFICATION_UNAVAILABLE; the Add-On never infers live.
- Connection.Options.Mode, Connection.Options.IsDemo, and the separately displayed connection kind are connection-wide observations only. They never classify an account.

## Scope truth

The runtime collections are captured sequentially from a changing NinjaTrader process. Except for the Add-On handler itself, every scope is therefore partial with CAPABILITY_UNSUPPORTED even when every source row validates. This is intentional: the observation is display and reconciliation evidence, not an atomic safety preflight. Any future strategy, connection, or process mutation must perform a separate just-in-time in-process preflight against the exact authorized account and expected state.

| Scope | Evidence retained | Additional partial/unavailable cases |
| --- | --- | --- |
| Add-On | authenticated handler produced the response | request fails if the handler itself cannot produce signed evidence |
| Connections | every captured connection validates, but capture is non-atomic | duplicate/invalid identity or property failure |
| Accounts | every captured account and connection reference validates, but capture is non-atomic | duplicate/invalid identity, missing connection, or property failure |
| Strategies | every captured strategy validates, but capture is non-atomic | nonempty sets are additionally partial/CAPABILITY_UNSUPPORTED because only an explicit safe base-property allowlist is exposed and custom parameters are omitted; property failures add SOURCE_ERROR |
| Positions | every captured non-flat aggregate account position validates, but capture is non-atomic | duplicate identity, unsupported side, invalid quantity/price, or property failure |
| Orders | all representable current working orders plus bounded completed history | a working order that cannot be represented fails the entire request closed; missing historical timestamps, invalid values, ambiguous ownership, or truncation add typed partial evidence |
| Executions | bounded history with a present dependency order and per-row temporal/quantity consistency | missing/invalid dependency, cross-reference failure, aggregate quantity exceeding the observed order fill, property failure, or truncation |
| P&L | daily unrealized only when the documented account-item source succeeds | daily realized and native lifetime are explicitly SOURCE_UNSUPPORTED; disconnected/non-USD/error states remain typed |

## Time, money, and bounds

- Session dates use the Windows Eastern Standard Time zone, the DST-aware Windows mapping for America/New_York.
- Native DateTime values with an offset are preserved. Unspecified native order/execution times are resolved with NinjaTrader's configured application time zone. Ambiguous or nonexistent local times are omitted with a typed partial scope instead of receiving an invented offset.
- USD money is converted with checked decimal multiplication by 100 and MidpointRounding.AwayFromZero, then bounded to the protocol's safe integer range.
- Connections are capped at 100; accounts and P&L at 500; strategies, positions, orders, and executions at 10,000.
- Orders and executions are enumerated directly under their source locks into bounded dictionaries. Completed orders and executions are batch-trimmed to the newest protocol-capacity window during capture; the Add-On never first materializes the full history.
- Every current working order that satisfies the wire contract is retained. If working state exceeds the item limit or any current working row cannot be represented, the request fails closed instead of returning an apparently safe incomplete order set.
- Executions must fall between their dependent order's submitted/completed timestamps when a terminal timestamp exists, and observed execution quantity may not exceed the dependent order's observed filled quantity. Missing history prevents an equality claim and keeps the scope partial.
- If the signed response is too large, the Add-On removes the oldest unreferenced completed orders and executions in halving batches, requiring logarithmic reserialization attempts rather than one full serialization per removed row.
- The fully serialized signed response, including its trailing newline, must remain below 5 MiB. If current state alone cannot fit, the request fails closed with the existing generic INTERNAL_ERROR response.

## NinjaTrader 8.1.7.2 API assumptions

The source was statically compiled against the installed 8.1.7.2 NinjaTrader.Core.dll and NinjaTrader.Gui.dll. It uses the public read-only surfaces confirmed in those assemblies:

- Connection.Connections, Connection.Options, Connection.Status, and Connection.PriceStatus
- Account.All, Account.Provider, Account.Strategies, Account.Positions, Account.Orders, Account.Executions, and the documented Account.Get(AccountItem, Currency)
- StrategyBase.Orders, strategy lifecycle/base properties, and documented position synchronization properties
- Order.OrderUpdates with OrderEventArgs.Time and OrderState
- Execution.Order, Execution.Time, and execution price/quantity/commission
- NinjaTrader.Core.Globals.GeneralOptions.TimeZoneInfo

This compile is not an installation or runtime acceptance test. The Add-On has not been copied into NinjaTrader, recompiled in NinjaTrader, connected to an account, or exercised against Sim101 by this change.

The persistent offline check is `runtime/ninjatrader-addon/tests/Test-OfflineRuntimeV2.ps1`. It compiles the exact Add-On source against the installed 8.1.7.2 assemblies, executes strategy-normalization and provider-classification vectors, and statically rejects the audited connection-classification, undocumented P&L, unbounded-history-copy, and non-atomic-completeness regressions. It does not load, contact, stop, install, or recompile anything in the running NinjaTrader process.
