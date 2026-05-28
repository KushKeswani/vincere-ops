# Client Independence Feature Roadmap

Date: 2026-05-28

Goal: reduce support load by making Vincere Ninja Manager usable by clients who do not understand NinjaTrader, prop-firm rules, account cycling, or algorithm setup details.

## Evidence From Current Platform Behavior

- NinjaTrader Control Center is the central window for account, execution, order, log, position, connection, and strategy state.
  Source: https://ninjatrader.com/support/helpGuides/nt8/control_center.htm
- NinjaTrader Strategies tab exposes the operational fields the manager should validate: account display name, connection, data series, enabled checkbox, instrument, account position, strategy position, sync, realized PnL, and unrealized PnL.
  Source: https://ninjatrader.com/support/helpguides/nt8/strategies_tab.htm
- NinjaTrader strategy templates save parameter settings, but account defaults to Sim101 and Enabled defaults to false. The manager must therefore verify account and enabled state after applying any template.
  Source: https://ninjatrader.com/support/helpGuides/nt8/working_with_automated_strateg.htm
- Usability best practice for less-technical users is to prevent errors and reduce recall burden. In this product that means surfacing exact next actions, blocking unsafe states, and showing recognizable account/algo/template choices instead of asking users to remember NinjaTrader details.
  Source: https://www.nngroup.com/articles/ten-usability-heuristics/

## Production-Critical Additions

### 1. Setup Preflight Gate

Before any live Add All or enable action, run a mandatory checklist:

- NinjaTrader process is running.
- Control Center is visible to UI Automation.
- Orders grid is empty.
- Positions grid is empty.
- Configured prop connections are present.
- Expected NinjaTrader accounts are present.
- Strategy template files exist for every selected algo/template pair.
- Blueprint accounts are mapped to real NinjaTrader account ids.
- License key is verified.
- `READY_ALGOS_ENABLE_STRATEGIES=false` unless a human has explicitly approved live enable behavior.

Output should be a green/yellow/red checklist, not raw logs.

### 2. Add All Transaction Log And Rollback

The current Add All blocker is partial strategy row creation. Add All should behave like a transaction:

- Snapshot Strategies grid before starting.
- Add one strategy row at a time.
- After every row, verify strategy name, account, instrument, template marker, and Enabled=false.
- If any row fails, stop immediately.
- Offer rollback of rows created during this run.
- Save a run id and audit file.

This makes failure recoverable for clients and safer for support.

### 3. Strategy Row Verifier

Add a `Verify Setup` button that compares the manager database against NinjaTrader's Strategies grid:

- Missing strategies.
- Extra strategies.
- Wrong account.
- Wrong instrument or contract month.
- Wrong data series.
- Wrong enabled state.
- Account display name ambiguity.
- Template was defaulted instead of matched.

Do not require the user to infer correctness from NinjaTrader columns.

### 4. Guided Blueprint Review

The Edit Stack flow should become an account-by-account review wizard:

- Left rail: all accounts, each with status `Not reviewed`, `Ready`, `Needs attention`, or `Applied`.
- Main panel: only one account at a time.
- Inline warnings for missing templates or fallback version use.
- Explicit `Mark account ready` step before Add All can include that account.
- `Apply ready accounts only` action.

This avoids large grid fatigue and prevents accidental all-account operations.

### 5. Account And Prop Firm Deduplication

Add a normalization layer for account discovery:

- Deduplicate by real account id, not display text.
- Keep broker/display aliases as metadata.
- Show source connection and last-seen timestamp.
- Warn on duplicate display names.
- Warn when the same account is attached to conflicting algos.

This directly addresses the prior double-account issue.

### 6. Daily Readiness Mode

Keep `Get Algos Ready` split into safe and live phases:

- Safe phase: launch NinjaTrader, connect prop firms, apply/verify stacks, leave disabled.
- Live phase: enable strategies only when `READY_ALGOS_ENABLE_STRATEGIES=true` and all preflight checks pass.
- Manual override: require a clear confirmation and display orders/positions/strategy count before enabling.

Default should remain safe phase only until Add All is production-stable.

### 7. Client-Friendly Health Center

Add a single Health tab with plain-language statuses:

- NinjaTrader running.
- RDP desktop active.
- Prop connections connected.
- Market data fresh.
- Charts/strategies responsive.
- Logs clean.
- Last reconnect attempt.
- Last successful setup verification.
- Last strategy enable.

Include a `Fix automatically` button only when the action is deterministic and safe.

### 8. Support Packet Export

Add `Export Support Packet`:

- Sanitized `.env` values.
- Current app version/commit.
- Latest readiness report.
- Latest stack apply audit.
- NinjaTrader log/trace excerpts around errors.
- Screenshot bundle.
- Account/setup summary with account ids partially masked.

This lets support diagnose without screen-sharing every time.

### 9. In-App Knowledge Prompts

Use small info buttons instead of large explanatory blocks:

- Why Low Risk v1 is default.
- Why same algo on same prop firm should use the same version.
- Why strategies stay disabled after template load.
- What `Period 1` / `Period 2` means.
- What to do if Whop license is invalid.
- Why active RDP matters.

These should be contextual and concise.

### 10. Morning Simulation

Add `Simulate Tomorrow Morning`:

- Uses current settings and blueprint.
- Does not click live enable.
- Produces a timeline showing what would happen:
  - Launch NinjaTrader.
  - Connect prop firms.
  - Apply stack.
  - Verify strategies.
  - Enable skipped or enabled depending on safety gate.
  - Monitor health.

This gives clients and support confidence before a live morning.

## Nice-To-Have Additions

- Contract rollover assistant: detect stale futures contracts and suggest front-month updates.
- Template coverage report: show which algos have Low Risk v1-v5 / Period 0-2 templates.
- Client mode vs operator mode: hide advanced/debug controls from normal clients.
- Scheduler calendar: show next 5 planned automation actions in Eastern time.
- Failure replay: open the exact screenshot/log point where a setup failed.
- Versioned blueprint import history with revert.
- Post-run daily summary: accounts, algos, enabled count, connection events, warnings.

## Current Priority Order

1. Safety gate for Get Algos Ready strategy enabling.
2. Add All transaction logging and rollback.
3. Strategy row verifier.
4. Guided account-by-account blueprint review.
5. Support packet export.
6. Health Center.
7. Morning simulation.

## Production Rule

The manager should never require a client to know NinjaTrader internals to answer: "Am I ready to trade today?"

The app should answer that with a checklist, evidence, and one safe next action.
