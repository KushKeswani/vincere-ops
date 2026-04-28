# One-shot Windows (VPS) setup

Do this on the **same Windows user** that runs **NinjaTrader 8**.

## 1) Install prerequisites

- **.NET SDK 10 (x64)** — [Download](https://dotnet.microsoft.com/download/dotnet/10.0)  
Open a **new** PowerShell / `cmd` and confirm: `dotnet --version`
- **NinjaTrader 8.1** (you are on **8.1.6.3 64-bit** — good; keep that in your runbook)
- **Git** (if you clone on the machine)

## 2) Get the code

```powershell
cd $env:USERPROFILE\Desktop
git clone https://github.com/KushKeswani/vincere-ops.git
cd vincere-ops
```

## 3) Build + publish the Operator (one command)

From **PowerShell** in the repo root (right-click **Run with PowerShell** if policy allows):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\Setup-VincereOps.ps1 -PropConnectionName "Exact NT connection name"
```

`-PropConnectionName` must match the **connection name** shown in NinjaTrader Control Center (spaces allowed). Omit it only if you will edit `.env` yourself.

This creates a **Release** build under:

`%LOCALAPPDATA%\Programs\VincereOps\`

It creates `%LocalAppData%\Vincere.Operator\.env` from `.env.example` if missing, then **always** writes `**DRY_RUN=false`** (real IPC). To rehearse without the pipe: append `-DryRun $true`.

### Updates from GitHub

After you already cloned once, pull and rebuild + merge `.env` in one step:

```powershell
cd $env:USERPROFILE\Desktop\vincere-ops   # or your clone path
.\scripts\Pull-VincereOps.ps1 -PropConnectionName "Exact NT connection name"
```

`-SkipSetup` = only `git pull`. If `**nt8-addon**` changed, close NinjaTrader and run `**.\scripts\Install-VincereAddon.ps1**` again, then **Compile** in NinjaScript Editor.

Manual equivalent: `git pull`, then `**.\scripts\Setup-VincereOps.ps1`** with the same parameters as above.

## 4) Install the NinjaTrader Add-On (pipe server)

1. **Close** NinjaTrader.
2. Run from the repo root (recommended: `**Install-VincereAddon.cmd`** so the window stays open):

```powershell
.\scripts\Install-VincereAddon.cmd
```

Or:

```powershell
.\scripts\Install-VincereAddon.ps1
```

Double-clicking `**.ps1**` alone often closes the console **before you can read it** unless you launched PowerShell first. `**Install-VincereAddon.cmd`** avoids that.

The installer **searches** under your profile for `**NinjaTrader 8\bin\Custom`** and copies `**...\AddOns\VincereOperator\VincereOperatorIpcAddOn.cs`** into every match (or creates the usual path under Windows **Documents** if NT has never created `**Custom`** yet — normal on a brand-new install).

If you use **OneDrive** or the file still doesn’t show in NinjaScript Editor, search the PC for `**VincereOperatorIpcAddOn.cs`** after running the script, or pass `**-CustomDocumentsRoot`** (the folder that **contains** `NinjaTrader 8`).

1. Open **NinjaTrader** → **New** → **NinjaScript Editor** → **Compile** (fix any errors for your exact 8.1 build).
2. **Restart** NinjaTrader. In **Log / Output**, you should see **Vincere IPC** lines when the add-on loads.

## 5) Wire config

Edit:

`%LocalAppData%\Vincere.Operator\.env`

- `PROP_CONNECTION_NAME` = **exact** name from **Control Center → Connections**  
- `VINCERE_IPC_PIPE_NAME=VincereOperator` (default; must match the Add-On)  
- `DRY_RUN=false` when the add-on is working  
- `TELEGRAM_`* optional

## 6) Run

1. Start **NinjaTrader** and connect.
2. Run `%LocalAppData%\Programs\VincereOps\Vincere.Operator.exe` (or `dotnet run` from dev).
3. Complete **onboarding** if prompted.
4. **Dashboard** → **Test IPC (PING)** — should return **OK** (not DRY_RUN).
5. **Start bot** when ready.

## 7) “Apply stack” still does not create strategies

The Add-On **receives** `APPLY_STACK` and **logs** the JSON. **Creating** / **enabling** real strategy instances is **NinjaScript- and version-specific** — extend `VincereOperatorIpcAddOn.cs` in the `APPLY_STACK` case using your firm’s approach (or use manual control until you code that part).

---

Troubleshooting: see the main [README](README.md) and [nt8-addon/README](nt8-addon/README.md).