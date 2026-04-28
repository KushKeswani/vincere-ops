# NinjaTrader 8 — Vincere Operator IPC Add-On

This folder contains **`VincereOperatorIpcAddOn.cs`**, which runs **inside NinjaTrader** and hosts the **named pipe** that **Vincere Ops** connects to (`VINCERE_IPC_PIPE_NAME`, default **`VincereOperator`**).

## Why this exists

The desktop app (`Vincere.Operator`) cannot safely drive Control Center by itself. This Add-On runs **in-process** with NinjaTrader and handles JSON commands over a **local named pipe**.

Add-On C# targets **.NET Framework** inside NinjaTrader — avoid APIs only available on modern .NET (e.g. `string.Replace` with `StringComparison`).

The pipe loop must **dispose** each `NamedPipeServerStream` after every client; leaking handles causes “timed out” / **all pipe instances busy** when connecting from Vincere.

## Install (quick)

1. Close NinjaTrader.
2. From the repo root on your VPS, run:

   ```powershell
   .\scripts\Install-VincereAddon.ps1
   ```

   Or manually copy **`VincereOperatorIpcAddOn.cs`** to:

   `<Your Documents>\NinjaTrader 8\bin\Custom\AddOns\VincereOperator\`  
   (Use the same **Documents** folder Windows uses — often OneDrive — or run **`Install-VincereAddon.ps1`** which resolves it and supports **`-CustomDocumentsRoot`**.)


3. Open NinjaTrader → **New** → **NinjaScript Editor** → **Compile**. Fix any errors (your NT **8.1.x** build must compile this file).
4. Restart NinjaTrader. Check **Control Center → Log** for **`Vincere Operator IPC`** messages / errors.

## Commands implemented

| Command | Behavior |
|---------|----------|
| `PING` | Always returns OK (proves pipe works). |
| `REFRESH_CONNECTION` | Disconnect + reconnect by **connection display name** (payload `connectionName`). Runs on NinjaTrader’s dispatcher. |
| `ENABLE_ALL_STRATEGIES` / `DISABLE_ALL_STRATEGIES` | **Stub** — returns OK with a message to extend using your NT API version. |
| `APPLY_STACK` | Logs payload to NinjaTrader output; **strategy CRUD must be extended** for your templates/accounts. |

Extend the stubs using NinjaTrader’s docs for **Strategy** / **Accounts** for your firm.

## Pipe name

Must match **Vincere Ops** `%LocalAppData%\Vincere.Operator\.env`:

```env
VINCERE_IPC_PIPE_NAME=VincereOperator
DRY_RUN=false
```

## Disclaimer

NinjaTrader APIs vary by minor version. This code is written for **NT 8.1.x** patterns (`Connection`, `Core.Globals.ConnectOptions`). If compilation fails, use the Help Guide for your exact build and adjust namespaces/usings.
