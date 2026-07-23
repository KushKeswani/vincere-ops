# Supervised SIM control protocol 1.0

`sim-control/1.0` is a separate, opt-in mutation contract. It does not change runtime protocol `1.0`, which remains strictly read-only and `dryRun=true`.

The only initial command is `SET_SIM_STRATEGY_GRID_ENABLED`. It targets one opaque account reference and one opaque strategy reference, binds an exact fresh runtime state version and single-use approval, expires within 60 seconds, and requires a visible interactive confirmation. The schema has no broad account, all-strategies, connection, order, cancellation, flatten, or process-control command.

NinjaTrader does not expose a supported NinjaScript method for enabling an existing disabled strategy. The actuator is therefore explicitly `ninjatrader_control_center_uia` and may eventually operate only through UI Automation `TogglePattern` in an unlocked supervised desktop session. Cursor coordinates, mouse events, keyboard fallback, implicit retries, and use of the old Vincere Operator as a runtime dependency are prohibited.

The command remains unavailable until all three layers independently enforce:

- exact `LOCAL_ONLY` installation and local operator identity;
- companion capability `sim.strategy.uia.control` and heartbeat no older than 45 seconds;
- connected Add-On with a complete snapshot observed within 30 seconds;
- exact `simulation` account type and `connected` connection state;
- one unambiguous strategy target and a matching current state version;
- no pending event backlog or earlier nonterminal mutation;
- an unexpired, single-use approval whose intent hash matches the command;
- kill switch inactive for enable operations;
- a visible, unlocked interactive Windows desktop.

The companion must persist `actuator_invoked` before touching the UI. A timeout or crash after that point is `indeterminate`, never retry-safe, and requires discovery plus manual reconciliation and a new approval. Completion requires a causally linked post-action runtime event. Enabling must observe `enabled=true`, `sync=true`, and `runtimeState=running`; disabling must observe the exact target as disabled. If the read-only Add-On cannot observe the required post-state, completion must fail closed.

Schedules are durable dashboard records, not long-lived mutation commands. At the due time a schedule enters `awaiting_confirmation`; it never toggles unattended. An operator must obtain a fresh snapshot and confirm within two minutes, which materializes a new 60-second command. Missed, stale, disconnected, locked-desktop, or ambiguous executions become blocked and are not retried automatically.

This document defines the contract and gates; it does not claim that the actuator is enrolled, installed, or SIM-verified on Edith.
