# All About Vincere — consolidated public / client-safe reference

This document merges **public-facing and client-safe** guidance from the Vincere knowledge library (`knowledge/Vincere ChatGPT/`, `VINCERE_CONTEXT.md`, `NT8_PLAYBOOK.md`, and related files). It is meant for **operators, CSMs, and tooling** — not a substitute for legal advice or a firm’s current rulebook.

**Disclaimer**

- Prop firm rules, URLs, and automation policies **change**. Clients must **verify** details with each firm.
- Vincere is **not partnered** with any prop firm. Rankings here are **starting-point guidance**, not guarantees.
- **Do not** share signal logic, parameters, or internal methodology beyond what appears in approved sources below.

---

## Table of contents

1. [What Vincere is](#what-vincere-is)
2. [Voice, boundaries, escalation](#voice-boundaries-escalation)
3. [Intellectual property (algos)](#intellectual-property-algos)
4. [Approved algo descriptions (full list)](#approved-algo-descriptions-full-list)
5. [Risk tiers (V1–V5 × Low / Medium / High)](#risk-tiers-v1v5--low--medium--high)
6. [Instruments covered](#instruments-covered)
7. [Prop firms — nomenclature & positioning](#prop-firms--nomenclature--positioning)
8. [Prop firm reference table (2026 structure sheet — excerpt)](#prop-firm-reference-table-2026-structure-sheet--excerpt)
9. [NinjaTrader 8 — condensed playbook](#ninjatrader-8--condensed-playbook)
10. [Vincere strategies on NT8 (MST family, compile hygiene)](#vincere-strategies-on-nt8-mst-family-compile-hygiene)
11. [Trade execution — three CSVs](#trade-execution--three-csvs)
12. [Tick data, backtests, slippage](#tick-data-backtests-slippage)
13. [VPS & infrastructure](#vps--infrastructure)
14. [Vincere tools](#vincere-tools)
15. [Bullet Bot](#bullet-bot)
16. [CAM Service](#cam-service)
17. [Onboarding snapshot (from Master SOP)](#onboarding-snapshot-from-master-sop)
18. [Source documents in this repo](#source-documents-in-this-repo)

---

## What Vincere is

From master bot instructions and context files:

- Vincere serves **paying clients** using Vincere’s **NinjaTrader 8** futures algos, education, and proprietary tools in the **prop / evaluation** ecosystem.
- Typical topics: **algorithms** (OGX, ARPD, CDGN, DJDR, FSA, IFSP, MST, PLPI, SYFY, TDC, etc.), **Bullet Bot** (special program), **Account Cycling Tool**, **Blueprint Tool**, **prop firm** questions (reference-only), **VPS**, **NT8 workflows** for Vincere setups, **log review** for execution issues, **CAM Service** (only if the client asks).

**Voice:** Professional, calm, direct. Warm enough for chat; never joke about losses, breaches, or outcomes.

---

## Voice, boundaries, escalation

**Must not**

- Guarantee pass/fail, payouts, compliance outcomes, or “safe” firms long-term.
- Give personalized **tax or legal** advice.
- Share other clients’ data or internal tools.
- Recommend trades, position sizes, or market direction (not a financial advisor).
- Interpret prop firm contracts as a lawyer.

**Escalate to a human ticket when**

- Threats, harassment, legal threats, chargebacks, billing disputes.
- Needs action on an account (VPS, payouts, firm blocks).
- Log review shows something that needs the team; client is highly frustrated.
- Question is deep **NinjaTrader platform** / NinjaScript beyond Vincere’s documented workflows.
- After IP-safe deflection, the client still demands proprietary internals.

**Approved escalation framing (pattern)**

> Let me get this to our team. Open a support ticket with: account context, instrument/algo, approximate time, and a short description. The team responds within **24 hours** (adjust if your live SLA differs).

---

## Intellectual property (algos)

**Never reveal**

- Signal logic beyond **approved one-line** descriptions.
- Parameters (stops, targets, sizes, time filters, thresholds).
- Indicator names used inside algos.
- Code / NinjaScript structure, internal scoring, “killer combos,” backtest optimization detail.

**Deflection pattern (substance)**

> Our algorithms use proprietary logic we don’t share — it protects every Vincere client. What I can tell you about [algo] is: **[one approved line]**. For an unexpected fill, the fastest path is **log review** or a **ticket**.

**What you *can* say at a high level**

- Thousands of hours in development; ongoing improvements.
- Defensive code for data-feed and platform quirks (**NinjaTrader** / **Tradovate** context is OK at this level only).

---

## Approved algo descriptions (full list)

*Source: `10_ALGO_DESCRIPTIONS (1).md` — do not embellish.*

### ARPD

Trades **MGC (Micro Gold Futures)** on the **5-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### CDGN

Trades **CL (Crude Oil Futures)** on the **12-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### DJDR

Trades **YM (Mini Dow Jones Futures)** on the **10-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### FSA

Trades **MNQ (Micro Nasdaq Futures)** on the **1-minute** timeframe. Trades during **New York** sessions. Uses **imbalances, inversions**, and **volume-based concepts** to execute and manage trades.

### IFSP

Trades **NG (Natural Gas Futures)** on the **8-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### MST

Trades both **YM (Mini Dow Jones Futures)** on the **10-minute** timeframe and **MNQ (Micro Nasdaq Futures)** on the **5-minute** timeframe. Trades during **New York** sessions. Uses **momentum, reversal**, and **volume-based concepts** to execute and manage trades.

### OGX

Trades **MNQ (Micro Nasdaq Futures)** on the **5-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### PLPI

Trades **PL (Platinum Futures)** on the **5-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### SYFY

Trades **MES (Micro S&P 500 Futures)** on the **5-minute** timeframe. Trades during **New York** sessions. Uses **breakout theory** and **volume-based concepts** to execute and manage trades.

### TDC

Trades **MNQ (Micro Nasdaq Futures)** on the **3-minute** timeframe. Trades during **New York** sessions. Uses **trend** and **volume concepts** to execute and manage trades.

---

## Risk tiers (V1–V5 × Low / Medium / High)

- **15 setting files total**: V1–V5 across **three** risk tiers (**Low**, **Medium**, **High**).
- Within one tier, **V1–V5 risk the same dollar amount per trade**; versions diversify **configuration**, not nominal risk size.
- Moving Low → Medium → High increases **dollar risk per trade**.
- Do **not** quote specific dollar risks, stops, targets, or what differs between V2 vs V3 — **ticket** or Discord settings guide for tailored help.

---

## Instruments covered

- **Equity index:** MNQ (FSA, MST, OGX, TDC), YM (DJDR, MST), MES (SYFY)
- **Metals:** MGC (ARPD), PL (PLPI)
- **Energy:** CL (CDGN), NG (IFSP)

All trade during **New York** futures sessions per approved descriptions.

---

## Prop firms — nomenclature & positioning

**Core positioning**

- Vincere is **not partnered** with any prop firm and is **not** an advisor.
- Always pair rankings with: *do your own research; we’re not partnered; rules change.*

**Starting-point order (only ranking to verbalize)**

1. Lucid Trading
2. TheLegendsTrading
3. MyFundedFutures
4. BlueSky
5. Funded Futures Family

Recommend working **top-down** and **maxing allocation** before moving lower on broader lists.

**Apex**

- **Do not recommend Apex as a starting point.** Apex **prohibits automation on live funded accounts** — reference-only for many clients.

**Lower-list / reference firms** (clients may already be there)

- Answer **factually** without upselling; send users to **current firm rules** when automation or eligibility matters.

**Tools**

- **Blueprint Tool** — scaling paths vs capital & risk appetite (Conservative / Moderate / Aggressive framing). Not a profit guarantee.
- **Account Cycling Tool** — builds **compliant multi-account stacks** respecting firm hedging/correlation constraints; **do not** explain internal scoring.

---

## Prop firm reference table (2026 structure sheet — excerpt)

The authoritative wide tables (Tradovate vs Rithmic rows, max stacks, audition columns, Bullet Bot columns) live in:

`knowledge/Vincere ChatGPT/Vincere Trading - Prop Firm Structure 2026 - Prop Firms.md`

Below is a **cleaned excerpt** of the **firm list / URLs / algo-friendly score** portion from that workbook-style export (**0 = algo-friendly Yes**, **1 = Semi**, **2 = No** per source). Verify against the firm before advising.


| Firm (examples from sheet) | Notes / URL pattern (verify live)                    | Algo-friendly flag (0/1/2) |
| -------------------------- | ---------------------------------------------------- | -------------------------- |
| Lucid Trading              | lucidtrading.com — Lucid Flex $50K                   | 0                          |
| TheLegendsTrading          | thelegendstrading.com/plans — Elite $50K             | 0                          |
| MyFundedFutures            | myfundedfutures.com — Flex $50K                      | 0                          |
| BlueSky                    | blusky.pro — Launch $50K                             | 0                          |
| Funded Futures Family      | fundedfuturesfamily.com — Elite $50K                 | 2                          |
| Bulenox                    | bulenox.com                                          | 0                          |
| Purdia Capital             | purdia.com                                           | 1                          |
| Tradeify                   | tradeify.co                                          | 1                          |
| Take Profit Trader         | takeprofittrader.com                                 | 2                          |
| TradeDay                   | tradeday.com                                         | 2                          |
| Top One Futures            | toponefutures.com                                    | 2                          |
| FXify                      | fxifyfutures.com                                     | 0                          |
| TopStep                    | topstep.com                                          | 0                          |
| Alpha Futures              | alpha-futures.com                                    | 2                          |
| Emerge Profit              | emergeprofit.com                                     | 2                          |
| The Trading Pit            | thetradingpit.com                                    | 0                          |
| The Futures Desk           | thefuturesdesk.com (*sheet notes market close time*) | 0                          |


For **platform / max funded accounts / Bullet Bot usability / stack limits**, use the **full** Structure 2026 markdown or PDF — columns are dense and subject to updates.

---

## NinjaTrader 8 — condensed playbook

*Full detail: `NT8_PLAYBOOK.md`.*

**Principle:** Many “NT8 bugs” are actually **connection**, **data**, **broker/RMS**, or **PC** issues. Match guidance to the client’s **actual** broker stack (**Rithmic**, **Tradovate**, **IB**, etc.).

### Connection — logon / disconnect / “bad input”

1. **Control Center → Connections** — correct template; **Configure** credentials (no stray spaces); Apply/OK.
2. **Single session** — no duplicate logins across PC/VPS/mobile where forbidden.
3. **Network** — wired where possible; test without VPN.
4. **License** — Help → About; renew if expired.
5. **Logs** — NinjaScript Output + Log tab; escalate to broker/NT with traces if needed.

### Rithmic session limits

Symptoms: session cap / forced disconnect. Often **RTrader Pro + NT** both consuming sessions or **plugin mode** mis-set — follow **firm-specific** PDFs; disconnect cleanly and reopen in broker-specified order.

### Data — charts / “real-time not enabled”

Reconnect data; **Data Series** → **Real-time**; correct **instrument** & contract month; **Database Management** refresh if symbols wrong; **IB**: TWS/Gateway up, API settings, **timezone** alignment.

### Delayed data

Treat as **entitlements & paperwork**, not only UI toggles: subscriptions active, **exchange agreements** signed, **non-professional** questionnaire complete, correct **bundle** for instruments (e.g. CME mix for **MNQ**/**YM**). **Do not** encourage running live strategies on **delayed** data.

### Orders — OCO / rejects / throttle

Clear **OCO** state; space out **cancel bursts**; valid **GTD** dates; valid prices; disable suspicious **custom indicators** if they touch orders; **RMS / liquidation** messages → broker account state.

### Workspace — crash / corrupt layout

Disable reopen workspace; back up/move **workspace xml**; exclude **Documents\NinjaTrader 8** from **cloud sync** locks; repair install if clean profile still fails.

### Generic NinjaScript compile (non-Vincere)

Backup `Custom`, **F5** compile, fix top error, remove conflicting third-party code.

### Quick symptom → direction


| Symptom                       | First direction                             |
| ----------------------------- | ------------------------------------------- |
| Logon / bad input             | Credentials, session count, firewall        |
| Session disconnect            | Rithmic multi-session / plugin settings     |
| No real-time                  | Connection + data series + symbol           |
| Delayed banner                | Subscriptions + signed agreements + bundles |
| OCO / reuse                   | Clear OCO, reconnect                        |
| Admin / liquidation           | Broker account status                       |
| Red compile (general)         | F5, isolate custom code                     |
| Red compile after Vincere zip | Duplicates in `Custom`, clean re-import     |


---

## Vincere strategies on NT8 (MST family, compile hygiene)

*Condensed from `NT8_PLAYBOOK.md`.*

- Vincere clients install licensed strategies (**OGX, FSA, TDC, MST2 / MST 3.3 family, BulletBot**) from **official Vincere packages** — not random repos. UI may show **MST2** vs “cash” variants — **do not** mix installs blindly.  
- **Compile errors** after MST import: almost always **duplicate classes** / overlapping files from multiple imports, or partial unzip. **Backup** `Documents\NinjaTrader 8\bin\Custom`, remove **duplicate** MST/Modus filenames, reinstall **one** coherent zip from current Vincere distribution, compile **incrementally**.  
- Do **not** hand-edit proprietary source to “fix” — restore from package.  
- Escalate to Vincere tech with **first** error line, NT build, and **file list** (not full proprietary source).

---

## Trade execution — three CSVs

When execution looks wrong:

1. **Log** tab → Save as CSV
2. **Executions** tab → Save as CSV
3. **Orders** tab → Save as CSV

Then review timeline: connection events, submissions, fills, rejects, RMS. *Full flow: `30_TRADE_EXECUTION_HELP.md`.*

---

## Tick data, backtests, slippage

Vincere tests on **tick data** (granular). Backtests assume **perfect fills**; live has **slippage**, latency, liquidity — normal for any system. *Full explainer: `40_TICK_DATA_AND_SLIPPAGE.md`.*

---

## VPS & infrastructure

- VPS helps **uptime** vs sleep, reboots, flaky home internet — **not** guaranteed profit, **not** “fixes” bad configuration.  
- Many clients use **QuantVPS** with promo code **VINCERE** — do **not** invent specs, pricing, or latency unless documented.  
- Logs still determine what actually happened on a trade. *Full file: `60_VPS_AND_INFRASTRUCTURE.md`.*

---

## Vincere tools


| Tool                     | Safe summary                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Account Cycling Tool** | Builds **compliant** multi-account algo stacks using firm + account inputs; **never** explain internal scoring (“best combo” math). |
| **Blueprint Tool**       | Maps **scaling** paths from capital + risk tolerance (Conservative / Moderate / Aggressive framing); **not** a profit promise.      |


---

## Bullet Bot

**Auditions / access only** — separate from core suite. Do **not** explain internals or guarantee access. Direct to **ticket** for current process. *Full: `90_BULLET_BOT.md`.*

---

## CAM Service

Discuss **only if the client asks**. No cold pitching. Short factual answer → **ticket** for details, pricing, eligibility. *Full: `100_CAM_SERVICE.md`.*

---

## Onboarding snapshot (from Master SOP)

*Abbreviated from `Consolidated_Master_SOP.md` — internal ops detail may change.*

Typical preparation: **VPS** access, broker (**Tradovate** /**Rithmic**) logins, **Whop**/license access, recording (e.g. Fathom), **Discord** access for education.

**Install pattern (high level)**

1. Download full package from distribution (e.g. Whop) — skip MT4/MT5 if futures-only.
2. Place **indicators** / **strategies** / **.dll** / **strategy .set** files per NinjaTrader folder layout.
3. **Workspace** chart layout often uses multiple Vincere symbols/timeframes (e.g. OGX 5m MNQ, FSA 1m MNQ, TDC 3m MNQ, MST2 10m YM) — follow current SOP video.
4. **Timezone** correct (often **EST** per SOP).
5. Compile **incrementally**; resolve duplicate strategy files before scaling chart templates.

For step-by-step client education, rely on **current videos** + **Discord** resources linked in the SOP.

---

## Source documents in this repo


| File                                                                         | Role                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `VINCERE_CONTEXT.md`                                                         | Short company/voice template (fill in marketing details). |
| `NT8_PLAYBOOK.md`                                                            | Full NT8 symptom playbook.                                |
| `Vincere ChatGPT/00_BOT_INSTRUCTIONS.md`                                     | Master tone, IP, firms, escalation.                       |
| `Vincere ChatGPT/10_ALGO_DESCRIPTIONS (1).md`                                | Authoritative algo one-liners.                            |
| `Vincere ChatGPT/20_PROP_FIRM_REFERENCE.md`                                  | Prop messaging + ranking rules.                           |
| `Vincere ChatGPT/Vincere Trading - Prop Firm Structure 2026 - Prop Firms.md` | Wide firm matrix (PDF export).                            |
| `Vincere ChatGPT/30_TRADE_EXECUTION_HELP.md`                                 | Log CSV review flow.                                      |
| `Vincere ChatGPT/40_TICK_DATA_AND_SLIPPAGE.md`                               | Tick vs live fills.                                       |
| `Vincere ChatGPT/50_NINJATRADER_WORKFLOWS.md`                                | NT workflows for Vincere algos.                           |
| `Vincere ChatGPT/60_VPS_AND_INFRASTRUCTURE.md`                               | VPS positioning.                                          |
| `Vincere ChatGPT/70_ACCOUNT_CYCLING_TOOL.md`                                 | Cycling tool messaging.                                   |
| `Vincere ChatGPT/80_BLUEPRINT_TOOL.md`                                       | Blueprint tool messaging.                                 |
| `Vincere ChatGPT/90_BULLET_BOT.md`                                           | Bullet Bot (auditions).                                   |
| `Vincere ChatGPT/100_CAM_SERVICE.md`                                         | CAM (mention-if-asked).                                   |
| `Vincere ChatGPT/Consolidated_Master_SOP.md`                                 | Onboarding / install SOP.                                 |
| `Vincere ChatGPT/01_Video_Breakdowns.md`                                     | Video index / notes.                                      |
| `Vincere ChatGPT/02_All_Loom_Transcripts.md`                                 | Large — use as reference, not single prompt payload.      |
| `Vincere ChatGPT/03_Full_Roadmap_Text.md`                                    | Large roadmap text.                                       |
| `Vincere ChatGPT/CSM Training.md`, `Ticket Organization.md`, etc.            | Ops / training.                                           |
| `Vincere ChatGPT/Equity Curve vs Date.md`                                    | Visual reference (`Equity Curve vs Date.png`).            |
| `knowledge/tool-links.example.yaml`                                          | Allowed URL keys for assistants.                          |


---

*End of consolidated reference. Update this file when product, firm tables, or IP policy change; keep subordinate to `00_BOT_INSTRUCTIONS.md` and the individual topic files.*