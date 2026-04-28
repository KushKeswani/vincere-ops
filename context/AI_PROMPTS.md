# AI Prompt Kit

Use these prompts with another AI when handing off this repo or asking for focused work in other directories.

## A) Full-repo handoff prompt (Vincere Ops)

```text
You are taking over the Vincere Ops repo.

First read:
1) context/RUNNING_CONTEXT.md
2) README.md
3) SETUP_WINDOWS.md
4) nt8-addon/README.md

Then do:
- Summarize current architecture in 8-12 bullets.
- Identify top 5 production risks in the NinjaTrader IPC path.
- Propose a concrete fix plan (small PR-sized steps) with test strategy for each step.
- Implement only step 1 unless asked to continue.

Constraints:
- Keep Windows/NinjaTrader compatibility in mind (.NET Framework behavior on add-on side).
- Do not delete user runtime data.
- Any script changes must preserve one-command operator workflows on VPS.
```

## B) IPC deep-debug prompt

```text
Investigate why Vincere app IPC to NinjaTrader times out intermittently.

Context:
- Read context/RUNNING_CONTEXT.md first.
- Primary files:
  - src/Vincere.Core/Services/NinjaTraderIpcBridge.cs
  - nt8-addon/VincereOperatorIpcAddOn.cs
  - scripts/Test-VincereIpcSmoke.ps1
  - scripts/Sync-VincereOps.ps1

Tasks:
1) Build a fault tree for timeout causes (name mismatch, stale listeners, duplicate classes, user/session mismatch, parser/response issues).
2) Add deterministic diagnostics with minimal noise:
   - request ID propagation
   - connect latency
   - response parse failures
3) Add one script to detect duplicate add-on classes under NinjaTrader Custom tree.
4) Add a concise runbook section in context/RUNNING_CONTEXT.md.
```

## C) Stack UX/features prompt

```text
Enhance stack editing/import UX while preserving current behavior.

Read first:
- context/RUNNING_CONTEXT.md
- src/Vincere.Operator/MainWindow.xaml
- src/Vincere.Operator/MainWindow.xaml.cs
- src/Vincere.Core/Services/ExcelImportService.cs
- src/Vincere.Core/Services/StackApplyService.cs

Goals:
- Improve clarity of Period1/Period2 workflows.
- Ensure template selection sources are transparent and refreshable.
- Add validation before Apply (missing template/strategy/attachment warnings).
- Keep changes backward-compatible with existing DB rows.

Deliverables:
- code changes
- user-visible behavior summary
- test checklist (manual)
```

## D) Prompt template for another directory/repo

Copy/paste and fill placeholders:

```text
I need help in directory: <ABSOLUTE_OR_RELATIVE_PATH>

Project intent:
<1-3 sentences>

Current blocker:
<error/symptom>

What I already tried:
<bullets>

Success criteria:
<clear pass condition>

Required outputs:
1) Root-cause analysis
2) Minimal safe fix
3) Verification steps
4) Optional follow-up improvements

Constraints:
- Do not use destructive git commands.
- Preserve existing user data/config.
- Keep changes small and reviewable.
- If assumptions are needed, state them explicitly.

Before changing code:
- summarize current architecture/files touched
- list exact files you will edit and why
```

## E) “New agent onboarding” short prompt

```text
Read context/RUNNING_CONTEXT.md and onboard yourself to this repo.
Then give me:
1) 10-bullet system map
2) top 3 urgent fixes
3) a 2-hour execution plan
Do not implement until I approve.
```

