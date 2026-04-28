# Vincere Ops

**Vincere Ops** is a Windows desktop **operator** for **[NinjaTrader 8](https://ninjatrader.com/)** on a **VPS**: it schedules **prop connection** refresh and **strategy enable** windows (US **Eastern** time), watches **NT log** noise for disconnect-style symptoms, sends **Telegram** notifications, keeps **algo stacks** in a **local SQLite** database with **Excel import**, and talks to an in-process **NinjaTrader Add-On** over **named-pipe IPC** (when installed).

This repository is the **control plane** beside NinjaTrader — not a replacement for NT’s execution engine.

### One-shot install (Windows / VPS)

1. Clone the repo on the VPS.
2. **PowerShell (repo root):** `.\scripts\Setup-VincereOps.ps1 -PropConnectionName "Your NT connection"` — publishes to `%LOCALAPPDATA%\Programs\VincereOps\`, seeds `.env` if missing, sets **`DRY_RUN=false`**, and **`PROP_CONNECTION_NAME`** when you pass the parameter.
3. Close NinjaTrader, then: `.\scripts\Install-VincereAddon.ps1` — copies the NT8 Add-On source into **Documents\...\Custom\AddOns\VincereOperator\**.
4. Open **NinjaTrader → NinjaScript Editor → Compile**, restart NT.
5. Confirm **`VINCERE_IPC_PIPE_NAME`** (and Telegram keys if used) in `%LocalAppData%\Vincere.Operator\.env`.

**Later updates:** `.\scripts\Pull-VincereOps.ps1 -PropConnectionName "Your NT connection"` runs **`git pull`** then **`Setup-VincereOps.ps1`** with the same env behavior.

Full walkthrough: **[SETUP_WINDOWS.md](SETUP_WINDOWS.md)** · Add-On details: **[nt8-addon/README.md](nt8-addon/README.md)**

---

## Why this exists

Running prop/eval flows often repeats the same **Control Center** rituals: recycle connections, arm strategies at open, watch feeds, export performance. Vincere Ops centralizes **configuration**, **scheduling**, **stack definitions**, and **alerts** on the machine that already hosts NinjaTrader.

---

## Highlights

| Area | What you get |
|------|----------------|
| **Schedule** | Mon–Fri Eastern — configurable times for **connection refresh** (default `08:20`) and **enable all strategies** (default `08:25`), plus **EOD / weekly / monthly** digest hooks |
| **Stacks** | Per-account **strategy rows** (type, template, instance label, attachment) — **Save** locally, **Apply** sends `APPLY_STACK` over IPC |
| **Excel** | Import `.xlsx` with flexible headers (`Account`, `Template`, …) — **map** raw file accounts to your **local account list** before merge |
| **Telegram** | Optional `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for session and alert text |
| **Developer** | Passcode-gated **.env** editor (default passcode overridable with `DEVELOPER_PASSCODE`) — **never** commit secrets |
| **IPC** | `PING`, `REFRESH_CONNECTION`, `ENABLE_ALL_STRATEGIES`, `APPLY_STACK` — see `Vincere.Ipc.Contract` |
| **DRY_RUN** | `DRY_RUN=true` in `.env` simulates NT success for safe rehearsals |

---

## Architecture

```text
┌──────────────────────┐     named pipe      ┌─────────────────────────────┐
│  Vincere.Operator    │ ←── (JSON line) ──→ │  NinjaTrader 8 + Add-On   │
│  (WPF, this repo)    │                     │  (in-process, your build)  │
└──────────┬───────────┘                     └─────────────────────────────┘
           │
           ▼
  %LocalAppData%\Vincere.Operator
     .env  |  vincere.db  |  logs
```

- **`.env` + Windows environment variables** — OS **wins** over the file (see [`.env.example`](.env.example)).
- **SQLite** — accounts, stack rows, EOD performance rows, scheduler checkpoints.
- **NinjaTrader Add-On** is **not** built in this repo by default: you host the in-process side that listens on the same pipe name (`VINCERE_IPC_PIPE_NAME`, default `VincereOperator`). Point the add-on at the same command contract in `Vincere.Ipc.Contract`.

---

## Repository layout

| Path | Purpose |
|------|---------|
| [`src/Vincere.Operator`](src/Vincere.Operator) | WPF **UI** (onboarding, dashboard, stacks, Excel, developer) |
| [`src/Vincere.Core`](src/Vincere.Core) | **EF Core** + **services** (scheduler, Telegram, NT bridge, reporting) |
| [`src/Vincere.Ipc.Contract`](src/Vincere.Ipc.Contract) | **IPC** DTOs + command names |
| [`knowledge/`](knowledge) | **Non-secret** context for your team (prop names, NT quirks, runbook notes) — start with [`knowledge/README.md`](knowledge/README.md) |
| [`APPLICATION_OUTLINE.md`](APPLICATION_OUTLINE.md) | Stakeholder / product outline (running document) |

---

## Requirements

- **OS:** **Windows 10/11** or **Windows Server** (WPF + `net10.0-windows`).
- **.NET SDK:** **10** (see [global.json](https://learn.microsoft.com/dotnet/core/tools/global-json) if you pin).
- **NinjaTrader 8** on the same **Windows user** session as the app (typical on a **VPS** with RDP).
- **Telegram** (optional): create a **bot** with [@BotFather](https://t.me/botfather), get `chat_id` (e.g. from @userinfobot or your first `getUpdates`).

---

## Build

```bash
dotnet build
```

The solution file in this repo is [`Vincere.slnx`](Vincere.slnx) (`.NET` **slnx** format). You can also open the `src/*/*.csproj` files directly in **Rider** or **Visual Studio 2022+**.

**Run** the WPF app (from the repo root):

```bash
dotnet run --project src/Vincere.Operator/Vincere.Operator.csproj
```

On first launch, **onboarding** asks for **account numbers** and optional **Telegram** + **prop connection name**; data is stored under:

`%LocalAppData%\Vincere.Operator\`

---

## Configuration

1. Copy [`.env.example`](.env.example) to `%LocalAppData%\Vincere.Operator\.env` **or** set **User** / **System** environment variables in Windows.
2. **Precedence:** `Environment` **overrides** `.env` for the same key.
3. **Security:** do **not** commit `.env` (it is **gitignored**). For shared machines, set a strong `DEVELOPER_PASSCODE` and **rotate** Telegram tokens if exposed.

Key variables (see example file for the full list):

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `PROP_CONNECTION_NAME` — must match the **display name** in **NinjaTrader → Control Center → Connections**
- `VINCERE_IPC_PIPE_NAME` — must match the add-on’s server name
- `DRY_RUN` — `true` to avoid real NT side effects
- `CONNECTION_REFRESH_TIME`, `ENABLE_ALL_STRATEGIES_TIME`, `EOD_CUTOFF_TIME` — `HH:mm` in **local wall** for the **Eastern** day (times are compared in **Eastern**; the app uses `America/New_York` / `Eastern Standard Time` as available on the host)

**Developer panel** (in the app) unlocks after passcode — edits rewrite the **merged** dictionary back to `.env`.

---

## NinjaTrader 8 integration

1. Install **NT8**, note the **exact build**.
2. Install **your** **Add-On** that **hosts** a named pipe compatible with [`IpcRequest` / `IpcResponse`](src/Vincere.Ipc.Contract/IpcEnvelope.cs).
3. Ensure **pipe name** matches `VINCERE_IPC_PIPE_NAME`.
4. Use **`Test IPC (PING)`** in the dashboard before relying on scheduled actions.

Put firm-specific NT notes (paths, screenshots, connection spellings) in [`knowledge/`](knowledge).

---

## Operations checklist (short)

- Same **Windows user** for **NinjaTrader** and **Vincere Ops**.
- Keep the **RDP/console session** policy aligned with how your host treats disconnected sessions (interactive NT often needs an active session).
- After **NT upgrades**, recompile your **Add-On** and re-run **`PING`**.

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| IPC always fails | NT not running; add-on not loaded; pipe name mismatch; firewall (local pipes are usually unaffected) |
| Telegram silent | Missing token/chat id; bot blocked; outbound HTTPS blocked |
| Schedule skipped | Weekend (`Sat`/`Sun`); onboarding incomplete; bot **Stopped** in UI |
| `.env` ignored | Typo in path; forgot to reload after Developer save — restart app if needed |

---

## Contributing

Issues and PRs welcome. Keep **secrets** out of Git — use **`knowledge/`** only for **non-sensitive** operational context.

---

## License

MIT — see [`LICENSE`](LICENSE).

---

## Disclaimer

Trading involves risk. This software **does not** guarantee fills, connectivity, or compliance with any **prop firm** rules. **Verify** automation policies with your firm before production use.
