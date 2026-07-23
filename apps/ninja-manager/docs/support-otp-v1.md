# Client-owned support access: OTP foundation v1

## Status and boundary

This document describes the repository-only security foundation for client-controlled CSM read access. It does not add a page, cookie, route, middleware decision, runtime/EOD repository bypass, notification, deployment secret, or support-data integration. Until those separate integrations are reviewed, central staff still cannot read client operational data.

The client permanently owns tenant visibility. Staff cannot create, extend, broaden, or revoke a grant. The only allowed support scopes are `runtime.read`, `eod.read`, and `health.read`. Process control, strategy control, connection control, orders, manual trading, tenant wildcards, and any implicit scope are not representable.

## Grant flow

1. An authenticated active client creates a challenge in either `LOCAL_ONLY` or `CENTRAL_CONNECTED` mode.
2. The request names one to 32 exact enrolled agent IDs, one to three sorted read scopes, an optional sorted list of authoritative opaque account references per agent, and a requested support-session duration of five to 60 minutes. Every agent must resolve through `agent_installations.environment_id -> environments.client_id -> clients.user_id` to the requesting client. Null, unbound, another client's, or otherwise unresolved ownership fails closed even when the agent shares the same organization.
3. The repository returns an eight-digit OTP exactly once. The OTP expires after ten minutes. An idempotent create replay returns challenge metadata with `otp: null`.
4. Only an authenticated active staff user in `CENTRAL_CONNECTED` mode and in the same tenant can redeem. The challenge permits at most five failed attempts and exactly one successful redemption. Cross-challenge staff failures are limited to 20 per 15 minutes.
5. A successful redemption returns a random 256-bit bearer secret exactly once. An idempotent redemption replay returns session metadata with `bearerSecret: null`. Another redemption cannot recover or replace the secret.
6. Every read validation supplies the authenticated staff user, bearer secret, tenant, exact scope, exact agent, and the account reference when the grant is account-restricted. Validation appends a use event; it does not update a mutable `last_used` field.
7. A client can append a revocation for that client's pending challenge, one of that client's sessions, or every existing support session owned by that client. A client-wide revocation is a cutoff: it invalidates that client's sessions issued at or before the revocation while allowing a later, newly authorized session. It never revokes a peer client's sessions in the same organization.

An omitted account list means exact agent-level access only. It is not an account wildcard: an account-specific validation request is denied. If account targets exist for an agent, validation must provide one exact granted account reference.

## Secret handling

The repository constructor accepts an injected secret, clock, random-byte source, and deployment-mode provider. Tests use deterministic injections. The default secret loader reads `NINJA_MANAGER_SUPPORT_ACCESS_SECRET`; it requires at least 32 UTF-8 bytes. This foundation neither creates nor configures that environment variable.

- OTPs use a cryptographic, rejection-sampled eight-digit generator.
- Each challenge has a random 256-bit salt.
- The database stores only an HMAC-SHA-256 OTP verifier keyed by the injected secret.
- Opaque account references are stored in this subsystem only as purpose-separated HMAC-SHA-256 hashes.
- Support bearer values contain 256 random bits; the database stores only a purpose-separated HMAC-SHA-256 hash.
- OTP comparison uses fixed-size `timingSafeEqual` buffers. The same keyed comparison is performed for a missing challenge before the generic denial is returned.
- OTPs, bearer values, verifier values, salts, and raw account references are absent from canonical audit metadata, logs, and error messages.

Changing the injected secret invalidates outstanding OTPs, bearer sessions, and account-target hashes. Production secret rotation therefore needs a separately reviewed, client-visible revocation and re-grant procedure.

## Durable evidence and isolation

Migration `0013_support_otp_grants.sql` adds append-only challenge, challenge-target, attempt, redemption, session-target, revocation, and access-event records. Database triggers reject updates and deletes. The tables enforce:

- organization- and client-owner-scoped composite foreign keys for users, agents, challenges, redemptions, sessions, scopes, revocations, and targets;
- one redemption, one session, and one accepted attempt per challenge;
- a session bound to the exact challenge, redemption, redeeming staff user, and granting client user;
- an access event bound to the exact session, staff user, granted scope, granted agent, and, when non-null, granted account hash;
- OTP expiry no later than ten minutes and session expiry no later than 60 minutes;
- safe verifier/hash formats and bounded idempotency keys; and
- tenant-local idempotency for create, successful redeem, and revoke operations.

Create, successful redemption, validation, and revocation write canonical audit evidence in the same database transaction. An audit failure rolls back the associated security mutation or access event. Failed OTP attempts are themselves append-only security evidence and commit before the repository returns the generic denial, so an audit outage cannot reset the five-attempt lockout.

Audit metadata contains only safe challenge/session/event IDs, scopes, counts, deployment mode, requested duration, and expiry. It never contains an OTP, bearer, verifier, salt, raw account reference, password, credential, position, order, execution, P&L value, or strategy state.

## Failure behavior

Unknown challenge, wrong OTP, expired challenge, locked challenge, revoked challenge, already-redeemed challenge, wrong bearer, expired session, revoked session, wrong staff, wrong tenant, wrong scope, wrong agent, and wrong account all fail closed. OTP failures use one generic unauthorized result. The repository does not disclose whether a challenge, account, or support session exists.

Rate limits are serialized with row locks before append. Client creation is limited to five challenges per 15 minutes. A challenge permanently locks after five failed OTP attempts (and normally expires sooner); a central staff principal is denied after 20 failures in the rolling 15-minute window.

## Required integration gates

Before this foundation is exposed, a later milestone must independently review and implement:

- a client UI that clearly previews scopes, exact agents/accounts, expiry, and revocation;
- secure one-time OTP communication without placing it in logs, URLs, analytics, screenshots, or notifications;
- a central staff support-session carrier that is distinct from the ordinary login cookie and does not leak into browser storage;
- explicit calls from runtime, EOD, and health read repositories to `validateGrant`; no broad middleware bypass;
- authorization tests proving ordinary staff sessions remain denied without a valid support bearer;
- production secret provisioning and rotation using an approved secret store;
- application-level request throttling in addition to repository limits; and
- deployment, privacy, audit-retention, and incident-response review.

No support grant authorizes NinjaTrader mutation, launch/quit, strategy enable/disable, reconnect, scheduling, order entry, cancel, flatten, routing, or live/funded trading.
