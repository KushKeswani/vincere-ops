# Verification manifest — `a36b923`

Date: 2026-07-26 (America/New_York)

Commit under verification: `a36b923` (`Complete Ninja Manager prototype audit`)

Environment: macOS arm64; project-pinned Node.js 24.14.0 and npm 11.12.1. Tests used isolated in-memory, temporary, or fixture-only databases. No Edith, NinjaTrader, Add-On installation/compilation, account, strategy, order, network, service, scheduled task, production database, deployment, or live/funded trading action was performed.

## Automated gates

| Gate | Result | Evidence boundary |
|---|---|---|
| `npm run typecheck` | Pass | TypeScript source contracts. |
| `npm run lint -- --no-cache` | Pass | Repository lint policy. |
| `npm test -- --run` | Pass — 64 files; 560 passed, 1 skipped | Domain, repository, companion, UI, privacy, identity, and authorization boundaries. |
| `npm run db:verify` | Pass | 15 checksummed migrations and repeatable mode-specific seed state in both `CENTRAL_CONNECTED` and `LOCAL_ONLY`. |
| `npm run test:contract:csharp` | Pass — 2 vectors | Published Runtime-v1 cross-language canonicalization vectors; not Add-On compilation. |
| `npm run build` | Pass | Both Next.js production modes compiled. |
| `npm run test:listener` | Pass | Temporary `LOCAL_ONLY` production listener bound only to `127.0.0.1`; process tree exited and socket closed. |
| `npm run test:e2e` | Pass — 8/8 | Five central and three local fixture browser journeys, including loopback-only policy, role routing, Runtime-v2 partial evidence, Blueprint UI, accessibility, responsive layouts, and API denial paths. |

## P4 controls added

- Case-insensitive email identifies one global sign-in identity; migration refuses historical duplicates rather than selecting a tenant.
- Ambiguous `LOCAL_ONLY` client identity fails closed.
- Client Runtime-v2 inventory/read-only queues, process-control requests, and EOD capture require the agent → environment → client ownership chain; same-organization peer-client access is denied.
- Unknown product-action exceptions no longer expose internal error text to the browser or raw exception data to logs.
- Runtime-v2 final receipt is sampled after companion-owned process/ledger evidence; future observation timestamps render unknown.
- Blueprint mapping exposes only backend-eligible authoritative connected simulation accounts.
- Graceful quit is labeled as a queueable readiness check only. The v1 mutation preflight reports `atomicity: not_guaranteed`, so the companion remains blocked before any operating-system call.

## Unverified and blocked

- The deployed Edith Add-On remains v1 and has not been contacted in this work.
- Add-On Runtime-v2 and mutation-preflight C# source were not compiled or installed.
- A documented NinjaTrader-wide atomic snapshot primitive has not been established; process/SIM mutation remains unavailable.
- `CENTRAL_CONNECTED` staff detailed Runtime-v2 reads still need client-issued scoped support-grant enforcement before release.
- Managed PostgreSQL, production identity/MFA, packaging, deployment/recovery, scheduler execution, and authoritative supervised SIM outcomes remain unverified.
