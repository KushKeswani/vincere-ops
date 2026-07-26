# Local IPC v1

## Scope and authority

Local IPC v1 connects the per-user Vincere Ninja Manager companion to an in-process NinjaTrader Add-On over a Windows named pipe. It is deliberately read-only. The allowlisted commands are `PING`, `GET_CAPABILITIES`, `GET_RUNTIME_SNAPSHOT`, `GET_RUNTIME_OBSERVATION_V2`, and the separate additive `GET_MUTATION_READINESS_PREFLIGHT`. Unknown commands and every trading or configuration mutation are rejected.

`GET_RUNTIME_OBSERVATION_V2` adds the richer read-only observation surface without changing framing, authentication, named-pipe defaults, or protocol version. Existing v1 clients and the `GET_RUNTIME_SNAPSHOT` command remain compatible.

`GET_MUTATION_READINESS_PREFLIGHT` is not Runtime-v2 and does not upgrade sequential Runtime-v2 scopes to complete. It returns a five-second, target-independent simulation safety baseline containing aggregate account/strategy/position/order counts and a keyed state digest. The Add-On requires two consecutive bounded samples with equal keyed digests; any source error or changed digest blocks the preflight. Because supported NinjaTrader APIs do not provide a demonstrated transaction across those collections, v1 reports `atomicity: not_guaranteed` and cannot authorize actuation. See `mutation-readiness-preflight-v1.md` for the exact limit.

The initial integration must label snapshots `supervised_simulation`. Installing this source is not evidence that strategy `Sync` semantics, account classification, stable identity, or lifecycle mapping are correct for every client environment. Promotion to `authoritative_read_only` requires a recorded SIM acceptance matrix and an explicit protocol/configuration change.

## Process boundary

```text
Ninja Manager dashboard
  <-> authenticated dashboard agent HTTP API
Per-user companion process
  <-> authenticated \\.\pipe\VincereNinjaManager.v1
NinjaTrader Add-On
  -> documented Account.All and Account.Strategies APIs
```

The Add-On owns native NinjaTrader observation. The companion owns transport, identity masking, durable event sequence/outbox state, command acknowledgements, and dashboard delivery. Neither component may invent a successful observation when the other is unavailable.

## Local authentication

- The pipe server grants access only to the current Windows user SID and does not expose a network pipe.
- Setup creates a random 32-byte secret at `%LOCALAPPDATA%\Vincere\NinjaManager\secrets\ipc-secret.bin` and restricts its ACL to the current user and `SYSTEM`.
- Every request and response is HMAC-SHA-256 authenticated.
- Requests carry a UUID, UTC timestamp, and 128-bit nonce. The Add-On rejects clock skew over 30 seconds and replays retained in its bounded nonce cache.
- Comparisons are constant-time. Payloads are capped at 5 MiB and one UTF-8 JSON line per connection.

The HMAC input uses literal newline separators:

```text
request:  protocolVersion\nrequestId\nissuedAt\nnonce\ncommand\npayloadSha256
response: protocolVersion\nrequestId\nrespondedAt\nok\ncode\npayloadSha256
```

`payloadSha256` is lowercase SHA-256 of the exact UTF-8 `payloadJson` string. Signatures use the `hmac-sha256:` prefix and lowercase hex.

## Request and response

```json
{
  "protocolVersion": "1.0",
  "requestId": "00000000-0000-4000-8000-000000000000",
  "issuedAt": "2026-07-15T12:00:00.000Z",
  "nonce": "base64url-no-padding",
  "command": "PING",
  "payloadJson": "{}",
  "payloadSha256": "sha256:...",
  "signature": "hmac-sha256:..."
}
```

Responses echo the request ID and use codes `OK`, `INVALID_REQUEST`, `UNAUTHORIZED`, `REPLAY`, `CLOCK_SKEW`, `UNSUPPORTED_COMMAND`, `SECRET_UNAVAILABLE`, or `INTERNAL_ERROR`. Error payloads contain a stable code only; account names, tokens, secrets, request bodies, and stack traces must not be logged.

## Snapshot semantics

The Add-On enumerates a complete point-in-time copy of `Account.All` and each account's locked `Strategies` collection. It returns local identifiers only across the authenticated local pipe. The companion converts those identifiers into opaque references and HMAC fingerprints before any dashboard event is created.

For NinjaScript strategies, `Sync` is calculated by comparing the individual strategy position with its account position, matching the documented Strategies-tab definition. Strategies whose state cannot be safely determined use `sync=null`, `runtimeState=unknown`, and `stateCode=UNKNOWN`; uncertainty is never converted into green/running evidence.

The additive runtime observation v2 response can report P&L, execution, order, and position evidence as observations only. No order or position mutation, strategy enable/disable, connection mutation, SET/template loading, flattening, or risk enforcement is part of local IPC v1.
