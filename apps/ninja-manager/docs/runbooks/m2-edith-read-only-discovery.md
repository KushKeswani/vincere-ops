# M2 — Supervised Edith read-only discovery bring-up (runbook + approval request)

Status: **awaiting Kush's explicit per-step approval.** No Edith / NinjaTrader / Add-On / companion / service action has been taken. This document is a plan only.

Machine: **Edith** (the only approved NinjaTrader host). Account: **Sim101** only. All actions supervised at the RDP desktop.

## Why two steps

The v2 discovery pipeline is source-complete on all three tiers (C# Add-On, local IPC, companion), but the Add-On **binary currently deployed on Edith is still read-only v1** (`PING`, `GET_CAPABILITIES`, `GET_RUNTIME_SNAPSHOT`). So:

- **Step A** — a genuinely read-only bring-up against the *current v1* Add-On yields **accounts + strategies (+ enabled/sync state) + per-account connection status** only. No writes, no install.
- **Step B** — full M2 discovery (connections inventory, positions, working/completed orders, executions, unrealized daily P&L, per-scope Add-On health) requires **installing + recompiling the updated Add-On source in NinjaTrader** — a write step needing its own approval and a maintenance window. (Daily *realized* P&L and *native lifetime* P&L remain intentionally `SOURCE_UNSUPPORTED` even after install.)

These are two separate approvals. Step A can proceed without Step B.

---

## STEP A — Read-only bring-up against the deployed v1 Add-On (no install, no writes)

**Exact action:** start the companion in read-only "doctor" mode with an explicit v1 selection so it performs ONE local-IPC read from the already-running Add-On and prints a summary. Nothing is posted, installed, recompiled, connected, enabled, or mutated.

```powershell
powershell -NoProfile -File .\scripts\windows\Start-VincereNinjaManagerCompanion.ps1 -Mode Doctor -DoctorProtocol V1
```

- **Machine / account:** Edith; NinjaTrader already running on Sim101 (as-is); no connection/feed/account change.
- **Read/write effects:** READ ONLY. `companion doctor --doctor-protocol v1` opens the local named pipe `\\.\pipe\VincereNinjaManager.v1`, sends `GET_CAPABILITIES` + `GET_RUNTIME_SNAPSHOT` (v1 read commands), and prints the result. No event is posted to the manager; no file/registry/service/schedule change. The explicit v1 flag overrides a `runtimeObservationV2` block in the enrollment config for this doctor invocation only.
- **Preconditions:** IPC secret present at `%LOCALAPPDATA%\Vincere\NinjaManager\secrets\ipc-secret.bin`; companion enrolled (`enroll-local-companion`) — enrollment writes only the local companion config + secret, no NT contact.
- **Safety checks:** confirm NinjaTrader is on Sim101 and `OrdersGrid=0`/`PositionsGrid=0` before and after; the Add-On declares `read_only_supervised_simulation` authority and has no mutating command in its dispatch surface.
- **Rollback / stop condition:** none needed (read-only); stop the doctor process if anything is unexpected. No state was changed to roll back.
- **Success evidence:** the forced-v1 doctor prints the v1 snapshot — accounts (masked), strategies with enabled/sync state, connection status — proving the companion → local-IPC → deployed Add-On chain works read-only end to end.

**Approval requested for Step A:** run the read-only companion doctor against the current Edith Add-On. No install, no writes.

---

## STEP B — Install + recompile the v2 Add-On (write; separate approval + maintenance window)

**Exact action:** copy the updated Add-On source into NinjaTrader's Custom AddOns folder, register it in `NinjaTrader.Custom.csproj`, and recompile in NinjaTrader (manual F5), to make `GET_RUNTIME_OBSERVATION_V2` available.

- **Machine / account:** Edith; NinjaTrader **must be closed** for the file/project changes, then reopened **disconnected / SIM (Sim101)** for the recompile and verification.
- **Read/write effects:** WRITE to the NinjaTrader Custom project and AddOns folder only (`Install-VincereNinjaManagerAddOn.ps1` copies `VincereNinjaManagerIpcAddOn.cs`, injects a `<Compile>` entry + `System.Runtime.Serialization` reference, backs up the prior project/DLL/source with a rollback manifest, and verifies the installed source SHA matches the repo). The recompile is a manual F5 in the NinjaScript editor. **No account, connection, order, strategy, service, firewall, schedule, or credential change.**
- **Preconditions:** NT version exactly `8.1.7.2`; ≥3 GB free; `NinjaTrader.Custom.csproj` present; NinjaTrader closed. Run `Prepare-VincereNinjaManagerIntegration.ps1` first; optionally `-DryRun` the installer to confirm no file is written.
- **Safety checks:** installer refuses if NinjaTrader is running; source-hash verification; full backup + `Restore-VincereNinjaManagerAddOn.ps1` rollback path; bring NT up **disconnected/SIM**; snapshots stay labelled `supervised_simulation` until a recorded SIM acceptance matrix promotes to `authoritative_read_only`.
- **Rollback / stop condition:** `Restore-VincereNinjaManagerAddOn.ps1` restores the backed-up project/DLL/source; if the F5 recompile errors, revert via the rollback manifest and leave the v1 Add-On in place. Stop if NT version ≠ 8.1.7.2 or the csproj is unexpected.
- **Success evidence:** after recompile, `Start-VincereNinjaManagerCompanion.ps1 -Mode Doctor -DoctorProtocol V2` returns a `GET_RUNTIME_OBSERVATION_V2` result with per-scope Add-On health, connections, accounts (masked), strategies+enabled, positions, working/completed orders, executions, and unrealized daily P&L, with freshness within threshold and `ipcAuthenticated=true` — rendered by the v2 dashboard (now on both staff and client pages) with the integrity-digest provenance card. `OrdersGrid=0`/`PositionsGrid=0` before and after. A forced v2 doctor fails closed when `runtimeObservationV2` is absent or collection fails; it never falls back to v1.

**Approval requested for Step B (separate from A):** the exact install + recompile above, in a supervised maintenance window with NT closed.

---

## Not included in either step (explicitly out of scope here)

Starting/stopping strategies, connecting/disconnecting feeds, placing/cancelling/flattening orders, changing configuration/credentials/schedules/services, or any funded/live account. Those are later milestones (M3/M4) with their own approvals.
