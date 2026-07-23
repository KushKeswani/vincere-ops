# Feed & Algo Health 1.0

## Boundary

`feed-algo-health/1.0` is a deterministic, read-only interpretation of the latest authorized Runtime Observation v2 event and, when supplied, one prior event. It does not parse logs, query NinjaTrader directly, or expose any recovery actuator. It does not infer a successful recovery, a safe control preflight, account flatness, or absence of orders from an incomplete scope.

The local Day ops page reuses the Runtime v2 events it already reads for EOD readiness. `CENTRAL_CONNECTED` does not read this client-private evidence while client-issued, session-scoped OTP support access remains unimplemented.

The rendered view exposes only safe connection/provider display codes, strategy display/type/instrument labels, and masked account identifiers. Opaque references, fingerprints, event identifiers, process identifiers, and raw account identifiers are not part of the display model.

## Official NinjaTrader behavior represented

- NinjaTrader reports provider status per connection as well as an aggregate Control Center status. Its UI distinguishes fully connected, connecting, price-server loss, order-server loss, and disconnected states: [Connection Status](https://ninjatrader.com/support/helpGuides/nt8/status_bar.htm).
- `OnConnectionStatusUpdate` exposes `Status` for adapter/order-system connectivity and `PriceStatus` for the price feed. Health analysis therefore never collapses order status and market-data status into one signal. The current Add-On normalizes native `ConnectionLost` to Runtime v2 `error`, so the error diagnosis covers that native state: [OnConnectionStatusUpdate](https://ninjatrader.com/support/helpguides/nt8/onconnectionstatusupdate.htm).
- Runtime v2 has no market-data value literally named `degraded`; its `delayed`, `stale`, `unavailable`, and `unknown` values are the available price-feed concern classes and stay distinct in the view.
- With multiple providers, NinjaTrader's connection order, instrument support, and preferred real-time/historical connection settings determine data routing. Runtime v2 does not carry the effective instrument route, so more than one active provider is reported as routing ambiguity: [Multiple Connections](https://ninjatrader.com/support/helpguides/nt8/multiple_connections.htm).
- NinjaTrader strategy behavior after a connection interruption depends on `ConnectionLossHandling` and `DisconnectDelaySeconds`. A provider returning to connected is never labeled as strategy recovery: [ConnectionLossHandling](https://ninjatrader.com/support/helpGuides/nt8/connectionlosshandling.htm).
- The Control Center Log tab contains current-day events categorized as Information, Warning, Error, and Alert. The health view guides the operator to inspect it, but does not ingest or pattern-match its messages: [Log Tab](https://ninjatrader.com/support/helpguides/nt8/log_tab2.htm).

The existing supervised SIM boundary in `docs/sim-control-v1.md` also remains unchanged: NinjaTrader exposes no supported NinjaScript method for enabling an existing disabled strategy, and no mutation actuator is added by this feature.

## Deterministic diagnosis

Input time is explicit. Evidence must satisfy `asOf <= event occurredAt <= manager receivedAt <= analysis time`; invalid, reversed, or future chronology is untrustworthy. Age is recomputed conservatively from the earliest evidence timestamp and the supplied analysis time, so the producer's earlier freshness claim is not treated as permanently fresh. Connecting or disconnecting duration is evaluated only when the full observation clock is trustworthy and `lastStateChangeAt` is present, valid, and no later than `asOf`. The v1 warning threshold is 60 seconds.

Fail-closed findings cover:

- missing, stale, or time-untrustworthy evidence;
- Add-On offline, degraded, unsettled, or unauthenticated IPC state;
- provider order adapter disconnected, error, or unknown;
- connected order adapter with unavailable, stale, delayed, or unknown price-feed evidence;
- long provider transitions supported by trustworthy timing evidence;
- multiple-provider route ambiguity;
- disconnected, unavailable, or unknown account state;
- disabled, error, unknown, waiting-sync, pending, or not-synchronized strategy state;
- working, transitional, or unknown orders;
- open positions and incomplete order/position coverage;
- every partial or unavailable collection scope.

Every finding carries severity, privacy-safe evidence facts, deterministic blocker codes, and guided inspection/reconciliation steps. Informational findings may still carry a blocker when the observed state prevents an assumption that the intended stack is active.

## Safety rules

Guided steps are limited to refreshing authenticated observation evidence; inspecting per-provider Control Center state; inspecting today's Log tab; checking strategy `ConnectionLossHandling`, `DisconnectDelaySeconds`, and `StartBehavior`; inspecting preferred market-data routing; and manually reconciling the exact account/order/position/strategy state.

This surface has no buttons or endpoints for connection changes, strategy state changes, order actions, position actions, process actions, database changes, credential changes, or network changes. A later connected provider observation does not clear blockers by itself. Exact fresh account, order, position, strategy runtime, and synchronization evidence must be reconciled again.
