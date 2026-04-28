# Vincere Algos Operator — application outline (running document)

**Purpose:** Single place to describe what the Windows VPS application will do so stakeholders can review it, suggest additions, and track changes over time.

**How to use this doc:** Add bullets under **Open questions / proposed additions** when someone has an idea; move confirmed items into the feature sections and note the date in **Revision log**.

---

## One-line summary

A **Windows desktop application** on the trading VPS that **orchestrates NinjaTrader** (Control Center: strategies, connections), **stores client account context locally**, lets users **view performance by account**, **edit algo stacks** and **apply them into NinjaTrader**, runs a **Monday–Friday bot** on an Eastern schedule (including **8:25 AM** enable-all), **exports/imports performance**, produces **EOD / weekly / monthly** views, and sends **Telegram** notifications.

---

## Environment

| Item | Decision / assumption |
|------|----------------------|
| **Host** | Windows VPS (operator runs NinjaTrader here) |
| **Trading platform** | NinjaTrader **8** (Control Center: Strategies window, Connections) |
| **Schedule timezone** | **US Eastern** (handles EST/EDT); key time **8:25 AM Eastern** for enabling strategies |

---

## Configuration & environment variables (`.env`)

The Operator should support a **clear way** to set **non-code** values—especially **secrets** and **per-VPS** settings—without hardcoding them in the UI only.

### What we expect to support

- **`.env` file** (or equivalently **`.env.local`**) in a **documented** folder next to the app or under `%AppData%`—**not** committed to git. A **`.env.example`** (no secrets) ships with the app listing **every key** and a **short description**.
- **Windows environment variables** as an **override**: same names as in `.env`, read at startup (machine-level or user-level vars on the VPS).
- **Precedence (typical):** `Environment.GetEnvironmentVariable` **overrides** `.env` for the same key, so ops can set **one** secret in **Windows** and keep the rest in the file.

### Examples of keys (names illustrative until implementation)

| Category | Example keys | Notes |
|----------|----------------|--------|
| **Telegram** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | **Token** is **highly sensitive**; prefer **Windows Credential Manager** or **DPAPI** if the stack supports it, with **.env** as a **dev/single-user** option. |
| **Paths** | `DATA_DIR`, `NT_LOG_DIR` | Optional **overrides** if defaults under **Documents** are wrong. |
| **IPC** | `VINCERE_IPC_PIPE_NAME` | If the Add-On and app need a **configurable** channel name. |
| **Feature flags** | `DRY_RUN=true` | Optional **safety** for **apply** / **enable** in test. |
| **Developer** | `DEVELOPER_PASSCODE` | **Override** for the **Developer** screen passcode (default **`091209`** in the product spec if unset). |

### What the **client** still does

- **Create** or **edit** the **`.env`** (or set **User** / **System** **environment variables** in **Windows**) for the service account that **runs** the app.
- **Never** paste the **`.env`** into **Slack** or **email**; **back up** the file to an **encrypted** store if needed.
- The **first-time setup UI** can still **collect** Telegram / account data; the app may **write** those into **protected** storage and **optionally mirror** non-secrets into **.env** for **automation**-only deploys—**exact** behavior is a **product** choice, but the **requirement** is: **one** place to see **all** tunable **variable** names (the **`.env.example`** + runbook).

### Developer section (passcode protected)

A **hidden** or **“Advanced”** area in the app (e.g. **Settings → Developer** or a **keyboard shortcut**) for **you** to manage **environment**-driven config from the UI (in addition to editing **`.env`** on disk).

- **Access** — User must enter a **passcode** to open this screen. **Default passcode: `091209`**. Override it on the machine with **`DEVELOPER_PASSCODE`** (same as the other **env** keys) so **production** or **shared** VPSs are not stuck with the default. The app must **not** write the passcode to **plain** log files.
- **MVP contents** — **View / edit** the same **keys** as **`.env.example`**, show the **path** to the active **`.env`**, **Save** and **Reload config** for the running process, and optional **export** of a **redacted** config for support.
- **Security** — A **short** passcode is only as safe as **RDP** / who can use the **console**; set a **stronger** **`DEVELOPER_PASSCODE`** when the machine is not **solely** under your control.

---

## How we interact with NinjaTrader 8 (summary)

This product **does not** embed inside NinjaTrader as the trading engine. It uses **two pieces**:

1. **Vincere Operator** — Windows desktop app on the VPS (scheduler, UI, local data, Telegram, performance views).
2. **NinjaTrader 8 Add-On** — Small **in-process** component loaded **by** NinjaTrader that runs **your** commands (enable strategies, connection recycle, stack apply, optional exports) using NinjaTrader’s **API** where possible.

The app and the Add-On talk over a **defined channel** (e.g. **named pipe** or a **file command queue**), not by “watching a video” or **recorded mouse macros**. If the API does not expose an action on a given build, a **limited** **UI automation** fallback may be used—**not** as the default.

**Long term,** you still use a **written operator runbook** and a **version matrix** (NT8 build ↔ app/Add-On build). **Short videos** are **optional** for training people, not for the integration to work.

---

## First-time setup: what *you* do to get it up and running

This is the **one-time** (or new-VPS) **checklist** to go from a **blank machine** to “I can **Start bot** and the app can talk to NT8.” **Exact file paths and menu names** will be in the **shipped runbook**; this is the **order of operations**.

### Before you install anything

- Confirm the **prop / firm** allows **NinjaTrader** and the level of **automation** you plan (unattended, Add-On, etc.).
- Use **one Windows user** to run **both** **NinjaTrader 8** and the **Operator** app.
- Decide how you will keep the **RDP or console session** so **interactive** apps can run (policy depends on your **VPS** host).

### Step-by-step (do in this order)

1. **Install NinjaTrader 8** (official installer). Complete first launch, **license** / **login** as required. **Record the version and build** (e.g. from **Help → About**).
2. In NT8, open **Connections** and connect to your **prop** (or data) **at least once** by hand. **Note the exact connection name** as shown in the list—you will type the same string in the Operator app.
3. **Install the Vincere Add-On** per the release: add the project or **DLL** into NT8’s **Custom** / **NinjaScript** **workflow** and **compile** inside **NinjaTrader**. Open the **Log** (or error list) and fix any **compile** or **load** errors until the Add-On **loads clean** on restart.
4. **Install the Vincere Operator** (setup will say if you need a **.NET** **Windows Desktop** **Runtime**—install it if prompted).
5. **Sign in to Windows** as the same user, then **start NinjaTrader 8 first**, then **start the Operator** app.
6. In the **Operator**, run **first-time setup / onboarding**: **account numbers** and other **client** fields, **prop connection name** (must match step 2), **Telegram** **bot token** and **chat id** if you use alerts, and **schedule** (Eastern, **8:25** **enable**, etc.). If you use a **`.env`** file or **Windows** **environment variables** for **TELEGRAM_***, **paths**, or other **tunables**, set them **before** or **right after** install (see **Configuration & environment variables** above).
7. **Prove the link to NT8** using a **non-destructive** test from the runbook (e.g. **status** or **dry-run**). **Do not** turn on **live** “**apply** / **enable all**” until this step **succeeds**.
8. Click **Start bot** in the app. On a day you are allowed to test, confirm the **morning** steps (e.g. **connection refresh** and **8:25** **enable**) in **sim** or a **safe** **account** if your process allows—**not** first on a **live** **eval** you are not willing to disturb.
9. **Optional:** set the **Operator** to **start on Windows logon**; add a **note in the runbook** for your **RDP** / **reboot** behavior.
10. After you care about **history**, **back up** the app’s **data** directory (path in runbook).

**If something fails:** stop at the first **red** step (NT8 log errors, Add-On not loaded, app cannot connect to Add-On). **Do not** “**work around**” with **manual** **enables** in **live** while the **automation** is **half-broken** without a **runbook**-signed **exception** process.

---

## Core operator features

### Bot control

- **Start / Stop** the automation bot (when stopped, scheduled actions do not run).
- Bot is intended to run on **Monday–Friday** only (optional: skip **US market holidays** — TBD).

### Daily automation (typical trading day)

1. **Before market open sequence**
   - **Refresh prop firm connection(s)** (disconnect/reconnect or equivalent recycle per playbook).
   - Optionally assist **NinjaTrader login** if session expired (secure credential handling; **prop firm rules must allow** unattended operation).

2. **8:25 AM Eastern**
   - Open **Control Center → Strategies** and **enable all** deployed strategies (batch checkbox enable).

3. **During the session**
   - **Monitor charts** so **timeframes keep updating** (detect stalled / frozen behavior).
   - **Monitor NinjaTrader logs** for **price disconnects**, freezes, or connection issues.

4. **Shutdown / recycle (when playbook says so)**
   - **Disable** strategies.
   - **Disconnect** the prop firm from **Connections** in Control Center.
   - **Reconnect** the prop connection as required.

### Performance data

- **Export performance-related data from NinjaTrader** (exact export path TBD).
- **Import into the application** and associate with **stored account numbers**.
- **End-of-day (EOD)** performance in the UI.
- **End-of-week** and **end-of-month** summary reports (same metrics, rolled up).

### Notifications

- User configures **Telegram** (**chat ID** + bot token handled securely).
- Automated messages for important events (e.g. session milestones, errors, disconnects, EOD / weekly / monthly summaries — exact list TBD).

---

## Client data & onboarding

- **First launch / startup setup** asks for **client-side information** needed to run the product—especially **account numbers** and any other identifiers required to tie NinjaTrader data to the UI.
- All such data is **stored only on the local machine (VPS)** (encrypted-at-rest options TBD); **no default upload** of account numbers to the cloud.
- **Settings** allow **adding or retiring accounts** and re-running parts of setup without reinstalling.

---

## Account-centric UX

- The app **maintains a list of accounts** the client cares about.
- **Performance** is easy to browse **per account** (switch account, see EOD and period rollups).
- Unmapped or empty accounts should be visible/clear in the UI (not silently dropped).

---

## Algo stacks & provisioning

### Edit stack (primary day-to-day)

- **“Edit stack”** (e.g. per account) opens an editor for the **stack definition** (strategy type, template, instance name/label, account attachment—final field set TBD).
- **Save** stores the desired config **locally** (source of truth).
- **Apply** runs a **reconciliation** in **NinjaTrader**: add/remove/update strategy instances to match the saved stack, with **preview/summary** and optional **dry-run** before live apply.

### Excel (optional / bulk)

- User can upload an **.xls / .xlsx** file to **seed** or **bulk configure** stacks.
- A **mapping step** lets the client map **raw account numbers** in the file to the correct **algo stack** before anything is applied.
- **Merge policy** (replace vs merge per account when combining Excel + Edit stack) — **TBD**.

---

## Open questions / proposed additions

_Use this section to collect ideas. When something is agreed, move it to the sections above and add a **Revision log** entry._

- (add items here)

---

## Explicitly out of scope (unless we add it later)

- Replacing NinjaTrader’s own order/risk engine; the app **orchestrates** NT, it does not re-implement execution logic.
- **Cloud** storage of client PII by default (would be a separate, opt-in product decision).
- Guarantees about **prop firm** or **broker** API access without a technical spike on the specific NinjaTrader version and firm policy.

---

## Dependencies & risks (stakeholder awareness)

- **NinjaTrader integration** will prefer a **NinjaTrader Add-On (C#)** where possible; **UI automation** is a fallback and is more fragile across updates.
- **Prop firm terms** may restrict automation, unattended login, or certain connection behavior—must be **confirmed** for the target firm(s).
- **NinjaTrader version** and **connection display names** must be known to implement connection refresh and exports reliably.

---

## After the build: what is still left to do

Building the software is not the end; the system is **ops + product** for as long as you run it. Expect the following **after** you have a working app and Add-On.

### What the **client/operator** still does (day to day)

- **RDP or log into the VPS** when something needs a human (if the bot is not fully hands-off, or for first connect of the day in some setups).
- **Start** the app and **Start the bot** (or leave it set to **autostart** and only touch it on failures).
- **Respond to Telegram (or other) alerts** — e.g. disconnect, health check failed, apply job failed.
- **Use Edit stack / Apply** when they want to **change algos**; **fix** any **drift** if someone hand-edited NinjaTrader and the app shows a conflict.
- **Periodically check** in-app **EOD / week / month** numbers for sense and for **prop** or **internal** reporting.
- **Onboard new accounts** in **Settings** / setup when they get a new evaluation or account number.

### What **you (or support) still do** (recurring)

- **NinjaTrader updates** — When NT8 auto-updates or the user upgrades, you may need a **recompile** of the Add-On, a **smoke test** (version matrix), and sometimes a **small code fix** if APIs change.
- **Prop or connection changes** — If the firm renames a **Connection** or changes **logon** / **eval** flow, you **update** **config** in the app and revalidate the **connection refresh** path.
- **Windows / RDP / VPS** — Patches, **session** keep-alive policy, disk space, **antivirus** not blocking the app, and **backups** of the app’s **local database** (if you care about history after a machine loss).
- **Telegram bot** — If the **bot token** is rotated, or the user’s **chat_id** changes, **reconfigure**; if you add new **message** types, that is a **small product** change.
- **Excel template** — If the business **changes columns** in the sheet, you **update** the import + **docs** once.
- **Regulatory / firm policy** — Re-confirm that **automation** and **unattended** use are still allowed; this is **not** “solved by code” once.

### What is **not** a forever free ride

- **No** software removes the need to **watch** live risk, **prop** rules, and **market** conditions. The app is **orchestration and reporting**, not a guarantee of fills, pass, or no disconnects.
- **First line of failure** is still: **data** from the **prop/broker**, **NinjaTrader** stability, and **network** on the VPS.

---

## Revision log

| Date | Change |
|------|--------|
| 2026-04-27 | Initial outline from planning session (bot schedule, NT Control Center flows, onboarding, performance, Edit stack, Excel, Telegram, EOD/W/M reports). |
| 2026-04-27 | Added **How we interact with NinjaTrader 8**: Operator app + NT8 Add-On + IPC; runbook/video expectations. |
| 2026-04-27 | Added **After the build** — ongoing operator, maintenance, and policy work post-delivery. |
| 2026-04-27 | Added **First-time setup** — ordered checklist to get NT8 + Operator + Add-On up and running. |
| 2026-04-27 | Added **Configuration & environment variables** — `.env`, Windows env vars, `.env.example`, secret handling. |
| 2026-04-27 | Added **Developer section** (env editor, passcode; default `091209`, override `DEVELOPER_PASSCODE`). |
