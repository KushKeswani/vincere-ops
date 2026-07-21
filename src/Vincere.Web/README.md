# Vincere.Web — Browser Control Panel (MVP)

A thin ASP.NET Core minimal-API host that serves the operator control panel in a browser and
**reuses the existing `Vincere.Core` services** (orchestrator, IPC bridge, stack apply, Excel import,
scheduler). No trading logic is reimplemented here — the host only exposes HTTP endpoints that call Core.

## Hard constraints

- **Same machine as NinjaTrader.** The IPC to NinjaTrader is a local named pipe, so this host must run
  on the box where NinjaTrader runs. It binds to `http://127.0.0.1:5178` (loopback only). Web auth is
  deferred (single-operator); do not expose it off-box.
- **Run instead of the WPF app, not alongside it.** Both arm the same `TradingBotOrchestrator` timer and
  share the same SQLite DB — running both risks duplicate scheduled automation and DB write contention.
- **Guarded actions are gated by `LiveGuard`.** `enable-all`, `stack/apply`, `flatten/*`, `ready/run`,
  and enabling scheduled strategy-enable only fire live when **all three** hold:
  `DRY_RUN=false` **and** `VINCERE_WEB_ALLOW_LIVE=true` **and** the request body contains `"confirm":"LIVE"`.
  Otherwise they run simulated (in DRY_RUN) or are refused outright (nothing reaches NinjaTrader).
- Account numbers are masked to the last 4 in API responses; secrets/tokens are never emitted.

## Run

```bash
# Dry-run (safe, no live commands; works without NinjaTrader):
DRY_RUN=true dotnet run --project src/Vincere.Web/Vincere.Web.csproj
# then open http://127.0.0.1:5178/
```

## Endpoints

Safe (read-only or dry-run-guarded at the bridge):
`GET /api/status`, `GET /api/ping`, `GET /api/connections`, `GET /api/accounts`,
`POST /api/connections/{name}/{connect|disconnect|refresh}`, `POST /api/strategies/disable-all`,
`GET /api/schedule`, `POST /api/schedule`, `POST /api/scheduler/{arm|disarm}`,
`POST /api/blueprint/preview`, `POST /api/blueprint/import`.

Guarded (built, blocked live by default — see `LiveGuard`):
`POST /api/strategies/enable-all`, `POST /api/stack/apply`, `POST /api/flatten/all`,
`POST /api/flatten/account/{id}`, `POST /api/ready/run`.

## Known limitations / pre-live checklist

- **Blueprint preview/import is .xlsx only** (ClosedXML). CSV is not supported in the web host yet;
  the old `ui-prototype/server.py` accepted CSV — export as `.xlsx` instead.
- **Timezone:** the schedule is **Eastern** (matches `READY_ALGOS_TIME` / `EasternTime`). Product notes
  say "8:30 CT" = `09:30` Eastern — set the ready time in Eastern; the UI labels the field "Eastern".
- **Pipe-name drift:** the NT8 add-on constant was aligned to `VincereOperator` to match
  `VINCERE_IPC_PIPE_NAME`; it must be **recompiled inside NinjaTrader** to take effect. Until then, set
  `VINCERE_IPC_PIPE_NAME=VincereOperator2` in `.env` to match the currently-compiled add-on.
- **Going live** with any guarded action (or `READY_ALGOS_ENABLE_STRATEGIES=true`) requires: the Add-All
  instrument-selector failure fixed & retested (see `AGENT_HANDOFF.md`), the pipe-name fix applied, and a
  supervised test on the NinjaTrader box. Do not flip `VINCERE_WEB_ALLOW_LIVE=true` without that.
