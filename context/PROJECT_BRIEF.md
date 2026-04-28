# Project Brief (Big Picture)

This document explains what the project is trying to become, why it exists, what has been tried, and where it should go next.

## 1) End Goal

Build a reliable "operator control plane" for NinjaTrader-based prop trading workflows on a Windows VPS:

- predictable startup and daily routines
- clear, low-friction stack management per account
- safe automation gates (dry-run, period filters, row-level apply toggles)
- strong observability when connectivity fails
- reproducible setup for redeploy/recovery

The long-term goal is not just "send one IPC command." It is to create an operationally safe system where:
- an operator can hand over to another operator/AI quickly,
- setup and restore are one-command,
- breakages are diagnosable in minutes (not hours),
- strategy/template workflows are explicit and testable.

## 2) Product Scope (Current vs Target)

### Current
- WPF desktop app for onboarding + dashboard + account/stack editing
- Excel import of stack rows
- local SQLite persistence
- Telegram notifier hooks
- NinjaTrader Add-On pipe listener
- command scripts for pull/setup/install/test

### Target
- stable IPC under real VPS constraints
- deterministic NT Add-On lifecycle
- richer validation before apply
- complete strategy/template attach execution in Add-On (currently partial/stubbed areas remain)
- stronger operator runbook and backup/restore tooling

## 3) Non-Goals (for now)

- replacing NinjaTrader execution engine
- cloud-native orchestration that bypasses NT local runtime
- broad multi-platform support outside Windows + NT8 operational path

## 4) What We Tried (Timeline-style)

1. Initial setup and repo scaffolding:
   - operator app + core services + IPC contract + setup docs/scripts
2. Added NT Add-On copy/install scripts:
   - improved folder detection and OneDrive/Documents path handling
3. Fixed Add-On compile compatibility:
   - .NET Framework-safe APIs in NinjaScript context
4. Fixed Add-On load discovery:
   - moved add-on class into `NinjaTrader.NinjaScript.AddOns` namespace
5. Added startup traces/logging:
   - startup and loop traces in NT logs/messages
6. Added IPC resilience:
   - retries/timeouts/backoff on app client side
7. Added stack UX improvements:
   - template dropdown, period fields, apply filters
8. Added template discovery:
   - scan `NinjaTrader 8\templates\**\*.xml`
9. Added smoke tests and one-command sync scripts
10. Added context handoff docs + prompts

## 5) Key Technical Risks Discovered

1. NinjaTrader Add-On lifecycle can appear loaded but still have pipe contention/stale instance behavior.
2. Duplicate add-on source/class copies in NT `Custom` tree can create ghost behavior.
3. Pipe name mismatch between app and add-on is easy to trigger during rapid iteration.
4. User/session mismatch on Windows VPS causes hidden IPC failure even when code looks correct.
5. Setup scripts can change config paths/values in ways users perceive as data loss unless guarded with backups and explicit logs.

## 6) Architecture Intent

The architecture is "local-first ops control":

- App owns business logic, schedules, and local data.
- Add-On owns in-process NT actions and immediate broker/NT interactions.
- Named pipe is the boundary contract.
- Scripts are deployment glue and operator ergonomics.

This separation is good, but reliability depends on robust boundaries:
- contract version visibility,
- startup health checks,
- explicit, repeatable environment sync.

## 7) Why This Matters for Other AIs

Any AI continuing work should optimize for:
- operational certainty over elegant abstractions,
- transparent diagnostics over silent fallbacks,
- scripts that reduce manual operator memory load.

The quality bar is "can a tired human at 8 AM on VPS recover in 5 minutes."

## 8) Suggested Next Milestones

1. IPC hardening milestone
   - add duplicate-class detector script
   - add add-on self-health endpoint (`GET_STATUS` richer payload)
   - add client-visible latency and last-failure details in UI
2. Data safety milestone
   - auto backup `vincere.db` before sync/setup writes
   - backup/restore commands in scripts
3. Apply execution milestone
   - finalize `APPLY_STACK` behavior for real template attach flow
   - preflight validations before send
4. Operator UX milestone
   - guided "red/yellow/green" diagnostics panel
   - integrated script runner logs in-app

## 9) Definition of "Project Healthy"

- New VPS can be brought online with one script + compile/restart NT steps.
- Smoke test passes consistently.
- PING + apply round-trip diagnostics are visible and unambiguous.
- Context docs stay current after each meaningful change.

