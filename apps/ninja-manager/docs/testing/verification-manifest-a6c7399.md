# Verification manifest: `a6c7399`

- Verified commit: `a6c73994b8003b00ab738a8d072569fce8adc527`
- Branch: `reconcile/ninja-manager-edith-20260722`
- Verification completed: `2026-07-26T16:27:20Z`
- Host platform: macOS Darwin `25.5.0` on `arm64`
- Project runtime: Node.js `24.14.0`, npm `11.12.1`
- Lockfile SHA-256: `8765c351bee552c31e78654a4cb7274952a2ef6920494cad55a3481612da7b2e`

All Node commands used the pinned Node.js executable, not the host's global Node.js 25 installation.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Pass | 717 packages installed from the lockfile. |
| `npm run typecheck` | Pass | TypeScript completed with no diagnostics. |
| `npm run lint` | Pass | ESLint completed with no diagnostics. |
| `npm test` | Pass | 57 files; 520 passed, 1 skipped. |
| `npm run test:companion` | Pass | 11 files; 133 passed. |
| `npm run db:verify` | Pass | CENTRAL_CONNECTED and LOCAL_ONLY each verified 14 checksummed migrations and repeatable mode-specific seed state. |
| `npm run test:contract:csharp` | Pass | `unicode-number-order` and `empty-runtime-state` vectors passed. |
| `npm run build` | Pass | Fresh CENTRAL_CONNECTED and LOCAL_ONLY Next.js 16.2.10 production builds completed. |
| `npm run test:listener` | Pass | A bounded production process listened only on IPv4 loopback, rejected non-loopback interfaces, then exited with its socket closed. |
| `npm run test:e2e` | Pass | 8 Playwright tests passed across CENTRAL_CONNECTED and LOCAL_ONLY in 1.2 minutes. |

The first sandboxed build attempt was blocked when Turbopack's CSS worker tried to create an internal loopback listener (`EPERM`). The identical build passed outside that sandbox restriction. This was an execution-environment restriction, not an application diagnostic.

Generated build, database-gate, and browser-test artifacts are ignored and are not part of the verified commit.
