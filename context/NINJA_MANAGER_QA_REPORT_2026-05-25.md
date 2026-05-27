# Vincere Ninja Manager QA Report - 2026-05-25

## Scope

This pass tested the current `Vincere Ninja Manager - Kush` build deployed on the Windows VPS at `64.44.101.161`.

Primary goals:

- Verify the installed `.exe` launches and uses the updated Kush title/icon metadata.
- Test the setup/dashboard/edit-stack/settings surfaces as far as automation can safely reach.
- Verify NinjaTrader IPC connectivity and account discovery.
- Verify blueprint file structure and the new Period/template-default assumptions.
- Identify anything that still needs a human in the active RDP session.

## Environment

- Repo on VPS: `C:\Users\Administrator\Desktop\vincere-ops`
- Installed app: `C:\Users\Administrator\AppData\Local\Programs\VincereOps\Vincere.Operator.exe`
- Runtime data: `C:\Users\Administrator\AppData\Local\Vincere.Operator`
- NinjaTrader process: running
- Vincere Manager process: running
- IPC pipe: `VincereOperator2`
- License state: verified in local test-bypass mode
- `DRY_RUN=false`; live strategy enable was not invoked because it can turn on trading.

## Automated Results

| Area | Result | Evidence |
| --- | --- | --- |
| VPS build | PASS | `dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore` completed with `0 Warning(s), 0 Error(s)`. |
| Installed app restart | PASS | App redeployed with latest backup `VincereOps-installed-20260525-133718`; `Vincere.Operator` running after deploy. |
| App title/metadata | PASS | Installed file metadata reports `FileDescription: Vincere Ninja Manager - Kush` and `ProductName: Vincere Ninja Manager - Kush`. |
| Old icon source | PASS | Extracted `app.ico` from original `VincereNinjaManager.exe` and wired it into the WPF project. |
| XAML button handler coverage | PASS | Every `Click="..."` handler in `MainWindow.xaml` and `OnboardingWindow.xaml` resolves to a backing method. |
| IPC ping | PASS | `PING` returned `ok=true`, `message=pong` on pipe `VincereOperator2`. |
| IPC account listing | PASS | `LIST_ACCOUNTS` returned `ok=true` and 26 accounts from NinjaTrader. |
| IPC apply-stack path | PASS | Dry-run raw `APPLY_STACK` returned `ok=true`, `stub ok - logged payload; attach strategies in Add-On`. This confirms the BOM/parse failure is gone on the IPC path. |
| Blueprint file structure | PASS | `Vincere_Blueprint_2026-05-22.xlsx` opens successfully; sheet has `Cycle Period`, `Account`, `Prop Firm`, `Account Type`, `Stack Level`, and `Algo 1-4` columns. |
| Blueprint periods | PASS | Blueprint contains both `Period 1` and `Period 2`, matching the supported parser values. |
| Template files on NT disk | PASS | Strategy templates exist under `Documents\NinjaTrader 8\templates\Strategy`, including Low Risk `v1-v5` and Period `0/1/2` variants. |
| Control Center UI stack setup | PASS | `VINCERE_ENABLE_NT_UI_STACK_SETUP=true`; setup script uses Control Center > Strategies and the installed script was redeployed. |
| Control Center setup WhatIf | PASS | `Run-InvokeNinjaTraderUiStackSetupWhatIf.cmd` completed exit `0`: selected left-side strategy `CDGN-1.1` for requested `CDGN`, then `WHATIF configured CDGN MNQ JUN26 from Control Center`. |
| Control Center setup live OK path | PASS | `Run-InvokeNinjaTraderUiStackSetupLive.cmd` completed exit `0`: `configured CDGN MNQ JUN26 from Control Center`. No new `DialogResult` trace entry appeared after the fix. |

## Latest Retest - 2026-05-25 15:20 ET

The failing setup path was reproduced against the live NinjaTrader RDP session with `Run-InvokeNinjaTraderUiStackSetupOgxWhatIf.cmd`.

Result: **PASS in WhatIf mode**.

Evidence from `C:\Users\Administrator\Desktop\vincere-ops\logs\invoke-ui-stack-setup-ogx-whatif.log`:

- Selected left-side Control Center strategy `OGX-2.4` for requested `OGX`.
- Defaulted the missing blueprint template to `1 - OGX (MNQ) - 5 Min - Low Risk - v1 - Period 0`.
- Opened NinjaTrader's nested `Load Strategy Template` chooser and loaded that template by name.
- Configured `OGX MNQ JUN26` from Control Center.
- Exited `0` in `WhatIf` mode, so it canceled instead of creating another strategy row.

Root causes found and fixed during this retest:

- The real Control Center window was minimized/offscreen at `-32000,-32000`; the script now restores the top-level Control Center before clicking the Strategies grid.
- The first strategy selection path was reading NinjaTrader's hidden backing list instead of the visible left-side tree; it now selects from `treeAvailableItems`.
- NinjaTrader strategy templates do not open through a normal Windows file dialog. The script now opens the nested `Load Strategy Template` picker and selects the template by display name.

## Apply Button Retest - 2026-05-25 15:41 ET

A follow-up issue was reproduced from the saved VPS runtime data: the app appeared to "keep trying CDGN" because `Apply to NinjaTrader` read the last saved database rows instead of the current visible grid edits.

Root cause:

- The VPS `StackStrategies` table had multiple accounts with checked CDGN rows, often as `SortOrder = 0`.
- `ApplyStack_Click` called `StackApplyService.ExecuteAsync(...)`, and that service reads from SQLite.
- If the user unchecked CDGN, changed the row, or selected another row without pressing `Save Stack`, the apply command still sent the old saved CDGN row.

Fix:

- `ApplyStack_Click` now commits active DataGrid edits.
- It previews the exact checked rows that will be sent.
- It saves the visible grid state before calling NinjaTrader automation.

Validation:

- VPS build passed: `dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore` completed with `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-154117`.

## PF Strategy / Instrument Retest - 2026-05-25 16:07 ET

The setup script was updated to prefer NinjaTrader prop-firm strategy variants when available:

- `OGX` now selects `OGX-PF-2.4`.
- `CDGN` now selects `CDGN-PF-1.1`.
- Base strategies remain fallback only if no matching `-PF` strategy exists.

The app and setup script now normalize known Vincere instruments:

- `ARPD -> MGC`
- `CDGN -> CL`
- `DJDR -> YM`
- `FSA -> MNQ`
- `IFSP -> NG`
- `MST/MST-2 -> YM`
- `OGX -> MNQ`
- `PLPI -> PL`
- `SYFY -> MES`
- `TDC -> MNQ`

Validation:

- CDGN WhatIf payload intentionally had the wrong instrument `MNQ JUN26`; the script resolved it to `CL`, selected `CDGN-PF-1.1`, loaded `1 - CDGN (CL) - 12 Min - Low Risk - v1 - Period 1`, and exited `0`.
- OGX WhatIf selected `OGX-PF-2.4`, kept `MNQ JUN26`, loaded `1 - OGX (MNQ) - 5 Min - Low Risk - v1 - Period 0`, and exited `0`.
- Installed app redeployed with backup `VincereOps-installed-20260525-160143`.
- Apply operations now write an audit trail to `C:\Users\Administrator\AppData\Local\Vincere.Operator\logs\stack-apply.log` with rows/results but without the license key.

## PLPI Template Visibility Retest - 2026-05-25 16:21 ET

User reported that after selecting the account, the strategy window disappeared before selecting a template.

Root causes found:

- Runtime audit log showed the app sent `account = "Lucid Trading #5"` for PLPI. That is a blueprint label, not a valid NinjaTrader strategy account.
- PLPI's template slideout could be offscreen/empty after account selection, so clicking `template` threw `template slideout is not visible`; cleanup then closed the Strategies dialog.

Fixes:

- Apply payload now sends the actual selected NinjaTrader account unless a row already contains a real account id prefix (`APEX`, `LFE`, `LTD`, or `SIM`).
- Setup script now scrolls the NinjaTrader Properties panel to bring the template slideout into view before expanding/loading.

Validation:

- PLPI WhatIf selected `PLPI-PF-1.3`.
- Loaded `1 - PLPI (PL) - 5 Min Candle - Low Risk - v1 - Period 0`.
- Configured `PLPI PL` from Control Center.
- Exited `0`.
- Installed app redeployed with backup `VincereOps-installed-20260525-161706`.

## Blueprint 2026-05-25 Live Apply - 2026-05-25 22:14 ET

The new desktop blueprint was tested live:

- Source workbook: `C:\Users\Administrator\Desktop\Vincere_Blueprint_2026-05-25.xlsx`
- Runtime DB backup before changes: `C:\Users\Administrator\AppData\Local\Vincere.Operator\vincere-before-blueprint-clean-20260525-205330.db`
- Cleaned stack DB loaded into `C:\Users\Administrator\AppData\Local\Vincere.Operator\vincere.db`
- Apply log: `C:\Users\Administrator\Desktop\vincere-ops\logs\blueprint-20260525-live-apply.log`

Rows imported from the workbook:

- `Apex Trader Funding #3 -> APEX1526440000023`: Period 1 `DJDR/YM`, `IFSP/NG`; Period 2 `OGX/MNQ`
- `Apex Trader Funding #2 -> APEX1526440000027`: Period 1 `DJDR/YM`, `IFSP/NG`; Period 2 `IFSP/NG`
- `Lucid Trading #1 -> LFE0506703503010`: Period 1 `TDC/MNQ`, `RBO/M2K`, `ARPD/MGC`, `SYFY/MES`
- `Apex Trader Funding #4 -> APEX1526440000026`: Period 1 `DJDR/YM`, `IFSP/NG`
- `Apex Trader Funding #5 -> APEX1526440000025`: Period 2 `OGX/MNQ`
- `Apex Trader Funding #1 -> APEX1526440000024`: Period 2 `OGX/MNQ`

Notes:

- The workbook used `B2X (M2K)`. The manager now normalizes this to `RBO/M2K`, matching the `Algo Usage Map`.
- Stale saved stack rows were removed before importing the new blueprint so old PLPI/CDGN rows could not be applied accidentally.
- The live apply intentionally applied **Period 1 only**. Period 2 rows remain saved for account cycling.
- All created strategies were left disabled; live enable was not invoked.

Live apply result: **PASS**.

Evidence from the final apply log:

- `DJDR` selected `DJDR-PF-1.1`, loaded Low Risk `v1` Period 0 template, and set `YM JUN26`.
- `IFSP` selected `IFSP-PF-1.1`, loaded Low Risk `v1` Period 0 template, and set `NG JUN26`.
- `TDC` selected `TDC-3.4`; no matching Low Risk v1 template was found, so defaults were used, and it set `MNQ JUN26`.
- `RBO` selected `RBO-PF-1.8`, loaded Low Risk `v1` Period 0 template, and set `M2K JUN26`.
- `ARPD` selected `ARPD-PF-1.1`, loaded Low Risk `v1` Period 0 template, and set `MGC JUN26`.
- `SYFY` selected `SYFY-PF-1.4`, loaded Low Risk `v1` Period 0 template, and set `MES JUN26`.
- Scheduled task `VincereBlueprintPayloadApplyOnce` finished with `Last Result: 0`.

Visual verification in the RDP session confirmed the Control Center > Strategies tab contains the Period 1 rows with `JUN26` contracts and unchecked Enabled boxes.

Fixes made during this retest:

- Control Center detection now works even when NinjaTrader is on the Accounts tab.
- Instrument root parsing now preserves alphanumeric roots such as `M2K`.
- The fallback contract selector now scrolls the Data Series instrument editor into view and writes the inner `textBox` directly.
- Monthly futures fallback now uses the next month contract, so `NG` resolves to `NG JUN26` on May 25, 2026.

## Button Coverage

Static handler coverage passed for these dashboard/main-window buttons:

- `Start Bot`
- `Stop Bot`
- `Connect Prop Firms`
- `Disconnect Prop Firms`
- `Enable Algos`
- `Disable Algos`
- `Test IPC`
- `Refresh Templates`
- template info `?`
- `Add Row`
- `Delete Selected`
- `Save Stack`
- `Apply to NinjaTrader`
- `Choose Blueprint .xlsx`
- `Import Stacks`
- `Test License Key`
- `Reset invalid key`
- `Test Optional NT Login`
- `Save Prop Firm Settings`
- `Scan NinjaTrader`
- `Use Selected Connections`
- `Import Selected Accounts`
- `Save All Settings`
- `Open Developer Tools`

Static handler coverage passed for onboarding buttons:

- `Test License Key`
- `Reset invalid license key`
- `Open NinjaTrader`
- `Scan Prop Firms and Accounts`
- `Cancel`
- `Save & continue`

## Blocked Automated UI Tests

These checks were attempted but blocked by the current RDP/UI Automation state:

| Test | Result | Detail |
| --- | --- | --- |
| Full WPF UI smoke runner | BLOCKED | `Test-VincereOperatorWindowsUi.ps1` attached to the process but could not find a visible UI Automation window for PID `6280`. |
| Settings scan button runner | BLOCKED | `Test-VincereSettingsScanOnly.ps1` failed with `Vincere main window was not found`. |
| Direct NinjaTrader UI discovery from SSH | BLOCKED | `Scan-NinjaTraderUiDiscovery.ps1` returned `Control Center not found` from the SSH context. |
| Modal cleanup script | BLOCKED | `Close-NinjaTraderModalDialogs.ps1` closed `0` dialogs. The visible error appears to be in the interactive RDP desktop and is not visible to the SSH UIA context. |

## Current Visible Issue

Resolved in this pass:

`Unhandled exception: DialogResult can be set only after Window is created and shown as dialog.`

Root cause: the setup script invoked NinjaTrader's Strategies dialog OK/Cancel buttons through UI Automation `InvokePattern`. NinjaTrader's trace showed the exception came from `NinjaTrader.Gui.Tools.ObjectDialog.OnOkClick` through `ButtonAutomationPeer`.

Fix: `scripts/Invoke-NinjaTraderUiStackSetup.ps1` now uses physical center-clicks for Strategies OK/Cancel instead of `InvokePattern`.

Validation: a WhatIf run and a live OK run both completed from Control Center > Strategies. The live run added a disabled `Vincere UI Probe CDGN` row for `MNQ JUN26` on `LFE0506703503010`.

## What Still Needs Human Testing

Run these from the active RDP session after closing the old popup:

1. Dashboard safe buttons:
   - Click `Start Bot`, confirm state changes to running.
   - Click `Stop Bot`, confirm state returns to stopped.
   - Click `Test IPC`, confirm it reports an OK/pong-style response.

2. Settings scan:
   - Open `Settings`.
   - Click `Scan NinjaTrader`.
   - Confirm it shows available prop firm connections and actual NinjaTrader accounts.
   - Confirm Apex/Lucid are recognized correctly.

3. Settings selection:
   - Select the desired prop firm connections.
   - Click `Use Selected Connections`.
   - Select intended accounts.
   - Click `Import Selected Accounts`.
   - Click `Save All Settings`.

4. Blueprint import:
   - Open `Blueprint Import`.
   - Choose `C:\Users\Administrator\Desktop\Vincere_Blueprint_2026-05-22.xlsx`.
   - Confirm it parses rows.
   - Map accounts intentionally.
   - Import stacks.
   - Verify imported rows in `Edit Stack` use `Period 1` / `Period 2`.
   - Verify missing templates default to Low Risk `v1`.

5. Template dropdown:
   - Open `Edit Stack`.
   - For each algo row, open the template dropdown.
   - Confirm the dropdown is filtered to that algo's templates only.
   - Confirm Low Risk `v1` is selected by default where the blueprint did not specify a template.

6. Apply to NinjaTrader:
   - Use a sim/test account first.
   - Click `Apply to NinjaTrader` from a real imported blueprint stack.
   - Confirm no `DialogResult` popup appears. The direct script-level Control Center setup path passed after the click-mode fix.
   - Confirm it does not try to attach strategies from a chart.
   - Confirm the workflow remains Control Center > Strategies right-click only.

7. Live trading-control buttons:
   - Test only after switching to a sim/safe account or outside market risk.
   - `Connect Prop Firms`
   - `Disconnect Prop Firms`
   - `Enable Algos`
   - `Disable Algos`

8. Optional NinjaTrader login:
   - Test only with explicit user approval because it uses saved credentials.
   - Confirm blank credentials cause the app to ask the user to launch NinjaTrader manually.
   - Confirm populated credentials attempt optional startup/login without exposing the password.

9. Production license verification:
   - Current VPS is using `VINCERE_LICENSE_TEST_MODE=true`.
   - Test production Whop/Vercel license verification after backend env vars are configured.
   - Confirm invalid keys show the reset-key tutorial link.

## Notes / Recommendations

- Do not run live-action button automation while `DRY_RUN=false` unless the account is known to be safe for testing.
- The bridge can list accounts through IPC, but the Settings tab scan still needs an interactive RDP verification because SSH UI Automation cannot see the WPF window right now.
- The Control Center strategy-attachment automation now avoids the chart path, but full blueprint coverage should still be tested with the actual client blueprint rows and intended accounts.
- A disabled `Vincere UI Probe CDGN` test row was intentionally created during the live OK-path verification and can be removed from NinjaTrader after review.
- Consider adding a first-class automated test mode in the app that lets the UI run button commands against a fake bridge. That would let us test every button without touching live NinjaTrader state.

## Add To NinjaTrader Debug Pass - 2026-05-25 17:10 ET

Changes made:

- Fixed startup/Edit Stack behavior so the manager auto-selects the first account with saved stack rows after accounts load. Previously, after restart, `Apply to NinjaTrader` could silently do nothing because no stack account was selected.
- Updated the apply-button UI test harness to tolerate the selected account combo not exposing account text through UI Automation and to wait longer for NinjaTrader UI setup.

Validation:

- VPS build passed after the default-account fix: `dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore` completed with `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-165517`.
- Confirmed `DRY_RUN=true` on the VPS before testing.
- Confirmed Edit Stack now loads stack rows after restart. UI tree showed:
  - `CDGN / CL / Lucid Trading #5` unchecked.
  - `PLPI / PL / 1 - PLPI (PL) - 5 Min Candle - Low Risk - v1 - Period 0 / Lucid Trading #5` checked.
- Dashboard `Apply to NinjaTrader` dry-run integration test reached `StackApplyService` and wrote audit entries:
  - account resolved to actual NinjaTrader account `APEX1526440000023`.
  - blueprint label `Lucid Trading #5` was not sent to the NT Account combo.
  - strategy selected: `PLPI-PF-1.3`.
  - template loaded: `1 - PLPI (PL) - 5 Min Candle - Low Risk - v1 - Period 0`.
  - result: `WHATIF configured PLPI PL from Control Center`.

Current caveat:

- The app-level apply path is functionally passing in dry-run, but it is slow on the VPS. The two latest app-level dry-run audit results took about 66 seconds and 125 seconds from `stage=start` to `stage=ui-result`. This should be optimized before client release by adding timing logs inside `Invoke-NinjaTraderUiStackSetup.ps1` and reducing broad desktop/UIA scans where possible.
- The final harness process still timed out before seeing the WPF result dialog, but the app audit log recorded `ok=true` after the harness timeout. The harness timeout has been raised to 180 seconds for the next run.

## Production Automation Pass - 2026-05-25 17:40 ET

Changes made:

- Added scheduler state for `LastStackApplyDayIso`, `ActiveTradingPeriod`, and `LastAccountCycleIso`.
- Added production scheduling config:
  - `AUTO_APPLY_STACKS=true`
  - `STACK_APPLY_TIME=08:23`
  - `VINCERE_USE_UI_STRATEGY_TOGGLE=true`
  - `ACCOUNT_CYCLING_ENABLED=true`
  - `ACCOUNT_CYCLING_INTERVAL_DAYS=14`
  - optional `ACCOUNT_CYCLING_START_DATE=yyyy-MM-dd`
- Updated the daily bot sequence:
  - connection refresh still runs first.
  - stack setup applies the active account-cycling period before enable-all.
  - enable-all uses NinjaTrader Control Center UI automation when configured.
- Updated scheduled connection refresh and health reconnect to split `PROP_CONNECTION_NAME=Apex; Lucid` into separate connection commands instead of sending one invalid combined name.
- Added packaged script `Set-NinjaTraderStrategiesEnabled.ps1` with `-WhatIf` support so dry-run scheduled enable can verify the Strategies tab without toggling live strategies.
- Packaged the new script into the installed EXE output under `VincereOps\scripts`.

Validation:

- VPS build passed after scheduler/account-cycling changes: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-173946`.
- Confirmed `Vincere.Operator` and `NinjaTrader` are both running on the VPS.
- Confirmed deployed scripts include:
  - `Invoke-NinjaTraderUiStackSetup.ps1`
  - `Set-NinjaTraderStrategiesEnabled.ps1`
  - `Start-NinjaTraderWithOptionalLogin.ps1`
- Ran the strategy enable UI automation in interactive Task Scheduler `-WhatIf` mode. Result:
  - `WHATIF would set 2 of 2 visible strategy row(s) to enabled.`
  - exit code `0`
  - no live strategy checkbox state was changed.

Remaining verification:

- Run a one-minute-forward scheduler test with `DRY_RUN=true`, temporary `STACK_APPLY_TIME` and `ENABLE_ALL_STRATEGIES_TIME`, and the bot armed from the dashboard. Expected result: stack apply audit writes `ok=true`, then enable-all reports the same WhatIf strategy-toggle result.
- Run a health watcher simulation against a temp NT log directory and confirm a fake freeze/disconnect log line triggers per-connection refresh for both `Apex` and `Lucid` in dry-run.
- After the Whop/Vercel backend key is configured, run production license verification with a real valid key and an invalid key.

## Blueprint Setup Flow Pass - 2026-05-25 18:00 ET

Changes made:

- Changed Blueprint Import into a two-phase setup flow:
  - choose blueprint and map blueprint accounts to NinjaTrader accounts.
  - click `Save Account Setup` to save the local stack rows.
  - click `Attach Setup to NinjaTrader` only after review, so NinjaTrader is touched once at the end.
- Added a saved-setup attach action that loops through the accounts mapped by the latest blueprint save and applies their checked rows.
- Removed the broad fallback that could have attached older saved accounts if the latest mapped blueprint accounts had no checked rows.
- Guarded the Blueprint Import attach action so it requires `Save Account Setup` in the current setup pass before it can attach anything to NinjaTrader.
- Confirmed the NinjaTrader setup script no longer edits the strategy label/name.

Validation:

- VPS build passed after the setup-flow changes: `dotnet build .\src\Vincere.Operator\Vincere.Operator.csproj -c Release --no-restore` completed with `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-180402`.
- Confirmed the installed automation script has no `Set-StrategyName` or `NinjaScriptBasePropertyGridEditorName` references.
- Ran an interactive UI Automation probe through Task Scheduler and verified the live installed app exposes:
  - `Choose Blueprint .xlsx`
  - `Save Account Setup`
  - `Attach Setup to NinjaTrader`
  - the step text explaining blueprint -> account mapping -> save setup -> attach setup.

Remaining verification:

- Run a full human-supervised dry-run import using the actual client blueprint, save mappings for multiple real accounts, and click `Attach Setup to NinjaTrader` once from the Blueprint Import tab.
- Confirm the generated NinjaTrader Strategy rows are created from Control Center > Strategies > New Strategy, use the `-PF` strategy where available, select the expected instrument, load the expected Low Risk `v1` template by default, and do not alter the label.

## Strategy Dialog OK Fix - 2026-05-25 18:15 ET

Issue:

- The Control Center strategy setup path was reaching the final corrected strategy dialog state but not reliably committing it with `OK`.

Fix:

- Replaced the single final OK click with a verified confirm routine:
  - click the visible `btnOk` / `OK` button.
  - wait for the Strategies dialog to close.
  - retry with OK focus + space if it remains open.
  - retry with `Enter` if needed.
  - retry with a bottom-right physical click if needed.
  - throw a clear error if the dialog still does not close.
- Added status output showing which confirm method closed the dialog.

Validation:

- Copied the updated `Invoke-NinjaTraderUiStackSetup.ps1` to both the VPS repo and installed app script folder.
- PowerShell parser check passed: `syntax ok`.
- Confirmed installed script contains the new `Wait-DialogClosed` and `confirmed strategy dialog ...` paths.

Remaining verification:

- Run one supervised non-WhatIf setup against a safe/sim account to confirm NinjaTrader saves the row and the app receives the `configured ... from Control Center` success result.

## Developer Access Removal - 2026-05-25 18:30 ET

Changes made:

- Removed the `Developer` tab from the main client UI.
- Removed the `DevOpen_Click` entry point from `MainWindow`.
- Removed the developer passcode window, developer environment window, and developer access gate service from the project.
- Removed `DEVELOPER_PASSCODE` from `.env.example` and removed the runtime config property for developer passcodes.

Validation:

- Source search no longer finds developer-access entry points in `src` or `.env.example`.
- VPS build passed after the deletion: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-182642`.
- Interactive UI Automation dump did not find `Developer` or `Passcode` entries in the running app UI tree.

## Current Futures Instrument Selection - 2026-05-25 18:55 ET

Change made:

- Updated the NinjaTrader Control Center setup script so instrument selection no longer leaves only the root symbol in the field.
- The script now:
  - resolves the expected root symbol such as `PL`, `MNQ`, `MGC`, or `CL`.
  - types that root into `InstrumentSelector`.
  - waits for NinjaTrader suggestions.
  - clicks the visible suggestion labeled `Futures`, preferring suggestions that also include the root symbol.
  - fails clearly if no futures suggestion is found, instead of silently saving an unresolved instrument.

Validation:

- Copied the updated script to the VPS repo and installed app script folder.
- PowerShell parser check passed: `syntax ok`.
- Confirmed installed script contains `Find-InstrumentFuturesSuggestion` and the `selected current futures contract...` result log line.

Remaining verification:

- Run one supervised setup pass on a safe account and confirm the Strategy row displays the current contract month selected by NinjaTrader after clicking the `Futures` suggestion.

## Edit Stack Blueprint Review Flow - 2026-05-25 18:55 ET

Change made:

- Blueprint Import now saves the mapped account stacks, then moves the user into `Edit Stack` for account-by-account review.
- `Edit Stack` now has `Previous Account` and `Next Account` buttons.
- Switching accounts saves the current account stack before loading the next account.
- The old final attach action was removed from the Blueprint Import tab.
- `Edit Stack` now has:
  - `Add Selected Account` for one-account debugging.
  - `Add All to NinjaTrader` as the final production action.
- `Add All to NinjaTrader` saves the currently visible account first, then applies every account with checked stack rows under the selected period filter.

Validation:

- VPS build passed after the Edit Stack workflow changes: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-185135`.
- Interactive UI Automation verified the running app exposes:
  - `Previous Account`
  - `Next Account`
  - `Add Selected Account`
  - `Add All to NinjaTrader`

Remaining verification:

- Import the real blueprint, review two or more mapped accounts in `Edit Stack`, then run `Add All to NinjaTrader` and confirm all checked algos are created in NinjaTrader.

## Accounts Tab PnL And Algo View - 2026-05-25 19:00 ET

Change made:

- Updated the `Accounts` tab to show selected-account PnL summary and attached algos.
- Added a summary header with:
  - selected account name.
  - 90-day PnL total.
  - 90-day trade count.
  - latest imported PnL row.
- Kept the historical `PnL History` grid.
- Added `Algos Attached to Account`, sourced from saved stack rows for the selected account.
- The algos grid shows apply status, period, algo, instrument, template, and account attachment.

Validation:

- VPS build passed after the Accounts tab changes: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-185807`.
- Interactive UI Automation verified the running app exposes:
  - `AccountPnlSummaryText`
  - `AccountAlgoSummaryText`
  - `PnL History`
  - `PerfGrid`
  - `Algos Attached to Account`
  - `AccountAlgoGrid`
- The live VPS account view showed account `APEX1526440000023` with `3 saved algo row(s), 2 checked for apply.`

Remaining verification:

- Import or ingest real PnL rows from NinjaTrader/account reports and confirm the account summary updates from `$0.00` to actual account PnL.

## Duplicate Account Cleanup - 2026-05-25 19:05 ET

Issue:

- The Accounts tab showed duplicate account names after repeated NinjaTrader account imports.

Fix:

- Added account normalization during account import so the same account cannot be imported twice due to repeated scans or whitespace/case differences.
- Added startup database cleanup that groups accounts by normalized account number, keeps the best existing row, moves stack rows, PnL rows, and Excel mappings onto the kept account, then removes duplicate account rows.
- Added a unique `RawAccountNumber` index for newly created databases.
- Added a UI-side grouping in account reload as an extra guard.

Validation:

- Backed up the VPS database before cleanup:
  - `C:\Users\Administrator\AppData\Local\Vincere.Operator\vincere-before-account-dedupe-20260525-190353.db`
- VPS build passed: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-190412`.
- After restart, SQLite duplicate check returned `[]`.
- Current account rows are unique:
  - `APEX1526440000023`
  - `APEX1526440000024`
  - `APEX1526440000025`
  - `APEX1526440000026`
  - `APEX1526440000027`
  - `LFE0506703503008`
  - `LFE0506703503009`
  - `LFE0506703503010`
  - `LTD1506703503001`
  - `Sim101`
  - `Sim102`

## Blueprint Builder Link - 2026-05-25 19:15 ET

Change made:

- Added a `Get your blueprint built here` button beside `Choose Blueprint .xlsx` in Blueprint Import.
- The button opens `https://www.vinceretrading.com/accountcycling` with the Windows default browser.

Validation:

- VPS build passed: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-191214`.
- Interactive UI Automation verified Blueprint Import now exposes:
  - `Choose Blueprint .xlsx`
  - `Get your blueprint built here`

## NinjaTrader Launch, Shutdown, And Reset Schedule - 2026-05-25 19:35 ET

Change made:

- Added Dashboard buttons:
  - `Launch NinjaTrader`
  - `Shut Down NinjaTrader`
- Added a shared `NinjaTraderProcessService` used by Dashboard buttons and scheduled reset automation.
- Updated the optional NinjaTrader login script so it launches NinjaTrader even when auto-login is disabled; credentials are only required when optional auto-login is enabled.
- Added Settings and first-time setup controls below NinjaTrader username/password:
  - `Schedule NinjaTrader reset`
  - `Reset every [x] day(s)`
- Persisted reset settings in `.env`:
  - `NT_SCHEDULED_RESET_ENABLED`
  - `NT_RESET_INTERVAL_DAYS`
- Added `LastNinjaTraderResetIso` to app state so the reset runs only once per due day.
- Scheduled reset runs 15 minutes before the configured morning connection refresh window, then the existing connection refresh, stack apply, and enable-all schedule can proceed.

Validation:

- VPS restore completed after the package cache was missing `Microsoft.EntityFrameworkCore.Analyzers`.
- VPS Release build passed: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-193847`.
- Interactive UI Automation verified the running app exposes:
  - `Launch NinjaTrader`
  - `Shut Down NinjaTrader`
  - `Schedule NinjaTrader reset`
  - `NinjaTraderResetDaysBox` with value `7`
  - `Test Optional NT Login`

Not run live:

- I did not click `Shut Down NinjaTrader`; that would close the currently running NinjaTrader session.
- I did not wait for an actual scheduled reset window. Code path is built and deployed, but a live timed reset should be verified during a controlled non-trading window.

## Open Logs And Optional NT Password Fix - 2026-05-25 20:00 ET

Issue:

- The footer `Open logs` text was not clickable.
- Optional NinjaTrader login failed in the PowerShell script with `Unable to find type [System.Security.Cryptography.ProtectedData]`.

Fix:

- Replaced the footer text with an `Open logs` button that opens `%LocalAppData%\Vincere.Operator\logs`.
- Updated `Start-NinjaTraderWithOptionalLogin.ps1` to load `System.Security` / `System.Security.Cryptography.ProtectedData` before decrypting the DPAPI password.

Validation:

- VPS Release build passed: `0 Warning(s), 0 Error(s)`.
- Installed app redeployed with backup `VincereOps-installed-20260525-195950`.
- Verified the installed login script contains the DPAPI assembly load.
- Ran the installed login script with a short wait. It no longer throws the `ProtectedData` error and returned: `NinjaTrader started; no login dialog was found. It may already be logged in.`
- Interactive UI Automation verified `Open logs` is exposed as a clickable button.
