# Vincere Ninja Manager

The primary product is the client and staff operations dashboard in [`apps/ninja-manager/`](apps/ninja-manager/).

It provides guided onboarding, account and environment registration, system health, safe strategy recommendations, versioned configuration approval, deployment records, incidents, audit history, tenant isolation, and staff operations controls.

**Start the product:** [`apps/ninja-manager/README.md`](apps/ninja-manager/README.md)

---

## Existing operations assets

n8n workflow exports and documentation for **CSM grading**, **CAM grading**, and related automation.

## Start here

| Doc | Purpose |
|-----|---------|
| **[`projects/SETUP.md`](projects/SETUP.md)** | **All-in-one** setup: Google, OpenAI, Discord, env vars, import paths |
| **[`projects/csm-assistant/docs/OPERATOR-RUNBOOK.md`](projects/csm-assistant/docs/OPERATOR-RUNBOOK.md)** | **CSM assistant** — n8n dry-run, Discord, knowledge, tests (handoff for Codex / full setup) |
| [`n8n-credentials-setup.txt`](n8n-credentials-setup.txt) | CSM workflow credential names and checklists |
| [`projects/README.md`](projects/README.md) | Index of project folders |

## Workflow files (import into n8n)

- **CSM:** `projects/csm-grading-tool/n8n/CSM GRADING SYSTEM.json`
- **CAM:** `projects/cam-grading-tool/n8n/CAM GRADING SYSTEM.json`
- **CAM rollup:** `projects/cam-grading-tool/n8n/CAM METRICS ROLLUP.json`
- **CSM assistant (dry-run):** `projects/csm-assistant/n8n/CSM ASSISTANT — Dry-run.json` — see **OPERATOR-RUNBOOK** above

## Scripts (repo root)

- `_build_cam_workflows.py` — regenerate CAM + rollup from CSM JSON  
- `patch_workflow_sheets.py` — patch CSM workflow Sheet nodes  
- `scripts/*.mjs` — merge Discord path, monthly branch, low-value alert patches  

## More docs

- `operations-workflows/` — cross-cutting prompts, schemas, workflow playbooks  
- `CAM-GRADING-CONTEXT-AND-SPEC.md` — CAM spec  
