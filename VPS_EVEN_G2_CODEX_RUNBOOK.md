# VPS / Even G2 Codex Runbook

This runbook documents how to use Codex with the Windows VPS that runs NinjaTrader and Vincere Ninja Manager. The goal is to keep development on Git, keep live UI automation on the active Windows desktop, and make the workflow usable from Even Realities G2 terminal mode.

## Current Architecture

- Mac workspace: `/Users/kushkeswani/Projects/Vincere/Automation `
- Git repo: `https://github.com/KushKeswani/vincere-ops.git`
- VPS SSH alias: `phoenix-vps`
- VPS repo path: `C:\Users\Administrator\Desktop\vincere-ops`
- Published app path: `C:\Users\Administrator\Desktop\vincere-ops\src\Vincere.Operator\bin\Release\net10.0-windows\Vincere.Operator.exe`
- Runtime data path: `C:\Users\Administrator\AppData\Local\Vincere.Operator`
- NinjaTrader logs: `C:\Users\Administrator\Documents\NinjaTrader 8\log`

## Daily Codex Entry Points

From the Mac:

```zsh
cd "/Users/kushkeswani/Projects/Vincere/Automation "
codex
```

From the VPS PowerShell terminal:

```powershell
cd C:\Users\Administrator\Desktop\vincere-ops
codex
```

When using Even G2 terminal mode, use short prompts and keep Codex anchored to the VPS, for example:

```text
SSH into phoenix-vps, use the active RDP desktop, run the Vincere production readiness harness, and summarize pass/fail.
```

Codex is installed on the VPS at:

```text
C:\Users\Administrator\AppData\Roaming\npm\codex.ps1
```

## Pulling Updates On The VPS

Use this after changes have been committed and pushed from the Mac:

```powershell
cd C:\Users\Administrator\Desktop\vincere-ops
git pull --ff-only
```

If the VPS has local test artifacts that block the pull, save them first:

```powershell
git stash push -u -m "vps-local-before-pull"
git pull --ff-only
```

Then rebuild or publish as needed:

```powershell
.\scripts\Pull-VincereOps.ps1 -PropConnectionName "Apex; Lucid"
```

For a code-only sync without rebuilding:

```powershell
.\scripts\Pull-VincereOps.ps1 -SkipSetup
```

## Active Desktop Requirement

NinjaTrader UI automation must run inside the active Windows desktop session. SSH alone cannot see or click NinjaTrader UI controls. The test scripts use Windows Task Scheduler with `/IT` so commands run in the logged-in Administrator desktop.

Keep the RDP session open or at least unlocked when running:

- NinjaTrader scan
- strategy setup
- connect/disconnect buttons
- enable/disable strategies
- screenshot-based readiness tests

## Core Test Harness

Safe readiness pass:

```powershell
.\scripts\Start-VincereProductionReadinessTask.ps1
```

The harness writes reports under:

```text
C:\Users\Administrator\Desktop\vincere-ops\logs\production-readiness
```

Expected safe-prep result after the May 26 live prep:

```text
PASS=39, FAIL=0, WARN=1, SKIP=10
```

The May 26 live prep report was:

```text
C:\Users\Administrator\Desktop\vincere-ops\logs\production-readiness\20260526-222057\PRODUCTION_READINESS_REPORT.md
```

## Live Buttons And Guardrails

Dashboard actions can be invoked through:

```powershell
.\scripts\Invoke-VincereDashboardAction.ps1 -Action "Connect All"
.\scripts\Invoke-VincereDashboardAction.ps1 -Action "Disconnect All"
.\scripts\Invoke-VincereDashboardAction.ps1 -Action "Start NinjaTrader"
.\scripts\Invoke-VincereDashboardAction.ps1 -Action "Stop NinjaTrader" -ConfirmPrompt
```

Do not run live strategy enabling from Codex unless:

1. Orders are `0`.
2. Positions are `0`.
3. The user explicitly approves live enable.
4. The safe harness reports the enable what-if can see operable strategy rows.

Check grids:

```powershell
.\scripts\Probe-NinjaTraderGridCounts.ps1
```

Expected prep state:

```text
OrdersGrid: 0
PositionsGrid: 0
StrategiesGrid: present, disabled until morning enable
```

## Known May 26 Finding

After a long NinjaTrader session, the strategy Enabled checkboxes were visible but disabled to UI Automation. Restarting NinjaTrader cleared the stale state.

If this happens again:

1. Confirm `OrdersGrid=0` and `PositionsGrid=0`.
2. Stop NinjaTrader from the manager.
3. Confirm the shutdown prompt.
4. Start NinjaTrader again.
5. Run Connect All.
6. Rerun the safe readiness harness.

Supporting scripts:

- `scripts\Confirm-VincereDialogs.ps1`
- `scripts\Click-DesktopPoints.ps1`
- `scripts\Probe-DesktopWindows.ps1`
- `scripts\Close-NinjaTraderAuxiliaryWindows.ps1`
- `scripts\Dismiss-NinjaTraderDialogs.ps1`

## Blueprint / Setup Workflow

The production setup direction is:

1. Import the account cycling blueprint.
2. Build the account-by-account Edit Stack rows in the manager.
3. Select the correct account, algo, instrument, and template per row.
4. Use prop-firm `-PF` strategy versions where available.
5. Use the current futures contract by typing the root instrument and selecting the Futures entry from NinjaTrader.
6. Click Add All to NinjaTrader only after the full stack is reviewed.

The automation should not create duplicate accounts, and it should not leave the setup half-applied.

## Human Verification Still Required

- Real Whop license verification with production backend secrets.
- Full Add All on a clean NinjaTrader Strategies grid.
- Live Enable Strategies during the intended morning window.
- Confirmation that every account maps to the intended algo and template version.
- Confirmation that connection refresh recovers a real broker disconnect.
- At least one watched morning run from launch through connect, stack verification, enable, health monitoring, and end-of-day state.

## Even G2 Prompt Pattern

For short terminal prompts from the glasses, use direct wording:

```text
On phoenix-vps, run the safe Vincere readiness harness, do not enable strategies, and summarize the latest report.
```

```text
On phoenix-vps, check NinjaTrader orders, positions, strategies, and connection state. Do not click live enable.
```

```text
On phoenix-vps, pull latest git changes and run the Vincere app smoke test.
```

This keeps Codex focused on the VPS and prevents accidental local-only checks.
