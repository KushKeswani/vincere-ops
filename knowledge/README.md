# Knowledge base (context for collaborators & AI)

Drop **non-secret** reference material here so the team (and tooling) can reason about **Vincere Ops** without hunting through chat.

## What belongs here

- Product / operations context: how your **prop firm** expects **connections** named, typical **session** ritual, **eval** rules you care about.
- **NinjaTrader 8** specifics: exact **connection display names**, screenshot or notes from **Control Center**, quirks of your **templates** / strategy names.
- **Excel blueprint** conventions: column meanings, naming for **algo stacks**, examples (redact account numbers).
- Runbooks snippets: **RDP** policy on your VPS host, **backup** cadence for `%LocalAppData%\Vincere.Operator`.

## What does *not* belong here

- Live **account numbers**, **passwords**, **Telegram bot tokens**, **API keys**. Use **Windows Credential Manager**, `.env` on the machine (gitignored), or your vault — not the repo.

## Suggested filenames


| File                 | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `prop-firm-notes.md` | Firm-specific rules & connection names     |
| `ninjatrader-8.md`   | NT8 version pin, paths, manual steps       |
| `excel-schema.md`    | Columns your `.xlsx` imports use           |
| `vps-checklist.md`   | How you log on, reboot, verify the session |


Keep files **markdown** when possible so they render on GitHub.