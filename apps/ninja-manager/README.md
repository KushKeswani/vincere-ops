# Vincere Ninja Manager

Vincere Ninja Manager is a secure client and staff operations dashboard that turns complex trading-platform setup into a guided, approval-controlled workflow.

One shared application supports two explicit deployment modes:

- `CENTRAL_CONNECTED`: client and staff portal policy, tenant-scoped staff controls, runtime fleet discovery, and an outbound-only future companion boundary.
- `LOCAL_ONLY`: client-only dashboard policy on the Windows VPS, central sync/remote delivery/staff-fleet controls disabled, and an exact `127.0.0.1` listener enforced by the managed launcher.

The mode/capability/authority profiles, adapter interfaces, portability schema, both-mode UI behavior, dashboard agent API, and durable queue are implemented foundations. The repository now also contains an initial read-only companion, authenticated local IPC v1, and an offline-compiled NinjaTrader Add-On source. Those components remain `supervised_simulation`: they have not been installed, compiled inside NinjaTrader, or reconciled against a supervised SIM session. Production identity/MFA, centralized secrets retrieval, sync transport/inbox processing, operational cases, mutation commands, and production packaging remain incomplete.

The CENTRAL_CONNECTED dashboard implements one database-backed simulated path:

1. Staff creates a client login.
2. The client completes onboarding and acknowledges risk.
3. The client registers a prop-firm account, VPS, and NinjaTrader environment.
4. Ninja Manager displays health and required actions.
5. The client answers a plain-language strategy questionnaire.
6. A deterministic rules engine recommends an approved Vincere strategy.
7. The exact configuration is validated and versioned.
8. Staff approves or rejects that version.
9. The client records deployment status; Ninja Manager does not place trades.
10. Client and staff can inspect incidents and audit history.
11. A safe VPS failure simulation exercises the guided incident workflow.

## Local setup

Requirements: the project-pinned Node.js version in `.node-version` and the npm version in `package.json`.

For the fastest safe browser prototype, activate the pinned Node version and run:

```bash
npm ci
npm run prototype:local
```

Open `http://127.0.0.1:3000`. The launcher forces `LOCAL_ONLY`, binds only to `127.0.0.1`, migrates and seeds the isolated `.data/local-prototype` PGlite database, and labels the resulting records as fixture/demo evidence. It does not select `.data/ninja-manager`, connect to NinjaTrader, install an Add-On, or perform NinjaTrader actuation. Stop it with `Ctrl+C`. Re-running the launcher reuses and repeatably seeds only that prototype database.

For manual mode-specific setup:

```bash
cp .env.example .env.local
npm ci
npm run db:migrate
npm run db:seed
npm run dev:central
# or, after setting NINJA_MANAGER_MODE=LOCAL_ONLY:
npm run dev:local
```

Open `http://127.0.0.1:3000`.

### Windows desktop launcher

The Windows launcher starts or reuses the `LOCAL_ONLY` development dashboard on loopback, waits for `/api/health`, opens the sign-in page in the default browser, and starts NinjaTrader visibly only when NinjaTrader is not already running. It never stops an unknown process occupying the configured port and does not connect accounts, enable strategies, place orders, install the Add-On, or change Windows networking or startup policy.

Validate without starting applications or creating a shortcut:

```powershell
powershell -NoProfile -File .\scripts\windows\Test-VincereNinjaManagerShortcut.ps1
```

Create the current Windows user's desktop shortcut when the workstation is ready:

```powershell
powershell -NoProfile -File .\scripts\windows\Install-VincereNinjaManagerShortcut.ps1
```

The shortcut is intentionally a development convenience, not a production service. It requires the repository, installed Node dependencies, and the local database setup to remain available. Launcher logs are written under `%LOCALAPPDATA%\Vincere\NinjaManager\logs`; a signed/package-managed launcher and recovery policy remain production work.

### Read-only NinjaTrader integration

Run the offline safety checks first. They do not change NinjaTrader:

```powershell
powershell -NoProfile -File .\scripts\windows\Test-VincereNinjaManagerIntegration.ps1
npm run test:companion
```

With the local dashboard database available, prepare a dedicated agent identity plus current-user-only local secrets/configuration:

```powershell
powershell -NoProfile -File .\scripts\windows\Prepare-VincereNinjaManagerIntegration.ps1
```

The Edith launcher and preparation script default to `file://.data/operator-local-readiness`; they never select the preserved `kush-local` database implicitly. Enrollment records the database target in `companion.json` and fails closed if an existing enrollment belongs to a different or unknown database. To replace a stale enrollment without deleting its token, state, outbox, or logs, use `-ArchiveExistingEnrollment`; the prior files are moved under `%LOCALAPPDATA%\Vincere\NinjaManager\backups` before a new identity is created.

The preparation step does not install or compile NinjaTrader source. During a supervised maintenance window, close NinjaTrader fully and run:

```powershell
powershell -NoProfile -File .\scripts\windows\Install-VincereNinjaManagerAddOn.ps1
```

The installer refuses while NinjaTrader is running, when the detected version is not the reviewed version, or when the NinjaTrader drive has less than 3 GB free. It hashes the source, backs up the Custom project and existing source/build outputs, inserts the explicit compile/reference entries required by Edith's `EnableDefaultCompileItems=false` project, and writes an `install-manifest.json`. A supervised rollback uses `Restore-VincereNinjaManagerAddOn.ps1 -ManifestPath <manifest>` while NinjaTrader is closed.

Then start NinjaTrader disconnected or in an approved SIM-only configuration, open **New > NinjaScript Editor**, press **F5**, and resolve any NinjaScript compile error before proceeding. Do not connect a live account, enable a strategy, or approve an order-changing prompt for this read-only acceptance test. Once compilation succeeds, verify the authenticated pipe and sanitized snapshot:

```powershell
powershell -NoProfile -File .\scripts\windows\Start-VincereNinjaManagerCompanion.ps1 -Mode Doctor
```

`Doctor` prints only Add-On version, allowlisted commands, collection mode, and counts. It does not post events or expose account identifiers. After the visible NinjaTrader accounts/strategies have been reconciled with those counts in SIM, start one dashboard exchange or the continuous companion:

```powershell
powershell -NoProfile -File .\scripts\windows\Start-VincereNinjaManagerCompanion.ps1 -Mode Once
powershell -NoProfile -File .\scripts\windows\Start-VincereNinjaManagerCompanion.ps1 -Mode Run
```

The Add-On allowlist is exactly `PING`, `GET_CAPABILITIES`, and `GET_RUNTIME_SNAPSHOT`. Snapshots remain labeled `supervised_simulation`. See [local-ipc-v1.md](docs/local-ipc-v1.md) for authentication, privacy, replay, and authority details.

Set `NINJA_MANAGER_MODE` in `.env.local` to exactly `CENTRAL_CONNECTED` or `LOCAL_ONLY`. The `dev` and `start` launchers consume the validated host directly, reject command-line hostname overrides, and accept exactly `NINJA_MANAGER_BIND_HOST=127.0.0.1` in LOCAL_ONLY. Production requires an explicit mode; the generic development default remains CENTRAL_CONNECTED. CENTRAL_CONNECTED also defaults to loopback in this no-public-deployment phase and permits an explicit deployment host only through configuration.

Local demo accounts:

| Role | Email | Password |
|---|---|---|
| Staff | `staff@vincere.local` | `VincereStaff!2026` |
| Client | `client@vincere.local` | `VincereClient!2026` |

These values are demo-only and may be overridden with the variables in `.env.example`.

The staff demo identity is available only in CENTRAL_CONNECTED. LOCAL_ONLY accepts the client identity and removes staff/central-only navigation and actions rather than rendering dead controls.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npx vitest run src/lib/domain/runtime-contracts.test.ts
npm run test:contract:csharp
npm run db:verify
npm run build
npm run test:listener
npm run test:e2e
```

`npm run build` creates separate `.next-central-connected` and `.next-local-only` artifacts from the same source. Each artifact receives an atomically written schema-v2 `ninja-manager-build.json` bound to its mode, output directory, timestamp, and fresh Next.js `BUILD_ID`; `start` fails closed if the selected artifact, manifest, mode, or `BUILD_ID` does not match. `npm run test:listener` starts the LOCAL_ONLY production artifact briefly and verifies the operating-system listener is only `127.0.0.1`. The recorded Playwright matrix separately proves the managed development listener and both mode-specific browser policies.

## Database

Local development and tests use PGlite, an embedded PostgreSQL engine, at `.data/ninja-manager`. Current production configuration requires a PostgreSQL URL with certificate verification:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=verify-full
APP_URL=https://ninja.example.com
NODE_ENV=production
```

Migrations are in `migrations/`. Five migrations are currently present: 0004 adds product-installation mode, stable/versioned portable record state, outbox/inbox/conflict evidence, secret references, and origin-aware audit metadata; 0005 adds the canonical audit-subject/evidence invariants and completed product-idempotency ledger fields. The runner records a SHA-256 checksum for every migration and fails closed if an applied file is missing, changed, or represented by a legacy filename-only ledger without an explicitly trusted baseline. `npm run db:verify` proves all five checksums, repeatable demo migration/seeding, and mode-specific installation state on fresh PGlite stores. The seed remains a non-transactional fixture tool. No global migration lock, managed-PostgreSQL execution, or production LOCAL_ONLY storage adapter has been proven in this workspace.

## Safety boundaries

- No autonomous trading or trade placement.
- Strategy recommendations are deterministic and limited to staff-approved catalog entries.
- Every configuration is versioned and must be approved by staff before deployment can be recorded.
- All ten product mutation scopes (client creation, onboarding, client access, account/environment registration, recommendation, approval decision, deployment recording, health-failure simulation, incident transition, and kill switch) atomically commit the business change, canonical request-key result, and audit event. Exact retries replay the completed result; a changed organization, actor subject, scope, or canonical input conflicts. Approval decisions use a conditional transition so concurrent opposing decisions cannot both succeed.
- New product, portability, and runtime audit rows use one canonical v1 SHA-256 evidence shape that binds event/tenant/entity metadata, a stable actor-subject snapshot, occurrence time, and optional origin installation. Changing the actor or time invalidates the recorded hash; database row immutability is not claimed. Pre-0005 rows are retained as `legacy_unverified` with no evidence hash. Browser session lifecycle audit, full origin propagation (only staged portability events currently carry origin), and an external append-only archive/retention system remain incomplete.
- Organization scoping is enforced in the data-access layer and server actions.
- Account identifiers are masked before storage.
- NinjaTrader, VPS, Discord, GHL, and n8n connector boundaries have simulated health implementations only; no live integration is claimed.
- LOCAL_ONLY is bound to exactly `127.0.0.1` by the managed launcher. Any other configured bind host (including `localhost`, `::1`, and public/LAN hosts), any APP_URL host other than `127.0.0.1`, an APP_URL port mismatch, and command-line hostname overrides are rejected. This loopback dashboard listener is not local Add-On IPC and must not be publicly exposed; no firewall, tunnel, service, or deployment changes are part of local setup.
- No promise of trading returns is made.

See [architecture.md](docs/architecture.md) and [production-readiness.md](docs/production-readiness.md).
