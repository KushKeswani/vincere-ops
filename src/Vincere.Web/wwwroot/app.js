const navItems = document.querySelectorAll(".nav-item");
const panels = document.querySelectorAll(".panel-view");
const clock = document.querySelector("#clock");
const botState = document.querySelector("#botState");
const startBot = document.querySelector("#startBot");
const stopBot = document.querySelector("#stopBot");
const statusText = document.querySelector("#statusText");
const toolbarStatus = document.querySelector("#toolbarStatus");
const dropZone = document.querySelector("#dropZone");
const chooseBlueprint = document.querySelector("#chooseBlueprint");
const blueprintFileInput = document.querySelector("#blueprintFileInput");
const blueprintStatus = document.querySelector("#blueprintStatus");
const mappingList = document.querySelector("#mappingList");
const blueprintMapping = document.querySelector("#blueprintMapping");
const importStacks = document.querySelector("#importStacks");

let knownAccounts = [];
let blueprintRows = [];

function showPanel(id) {
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.panel === id));
  panels.forEach((panel) => panel.classList.toggle("active", panel.id === id));
  statusText.textContent = `${id[0].toUpperCase()}${id.slice(1)} selected`;
}

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  }).format(new Date());
}

navItems.forEach((item) => {
  item.addEventListener("click", () => showPanel(item.dataset.panel));
});

startBot.addEventListener("click", () => {
  botState.textContent = "Running";
  startBot.disabled = true;
  stopBot.disabled = false;
  toolbarStatus.textContent = "Prototype state changed to Running. No live NinjaTrader commands were sent.";
  statusText.textContent = "Bot running in UI prototype";
});

stopBot.addEventListener("click", () => {
  botState.textContent = "Stopped";
  startBot.disabled = false;
  stopBot.disabled = true;
  toolbarStatus.textContent = "Prototype state changed to Stopped. No live NinjaTrader commands were sent.";
  statusText.textContent = "Bot stopped in UI prototype";
});

if (dropZone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
      if (event.type === "drop" && event.dataTransfer.files.length) {
        loadBlueprintFile(event.dataTransfer.files[0]);
      }
    });
  });
}

if (chooseBlueprint && blueprintFileInput) {
  chooseBlueprint.addEventListener("click", () => blueprintFileInput.click());
  blueprintFileInput.addEventListener("change", () => {
    if (blueprintFileInput.files.length) {
      loadBlueprintFile(blueprintFileInput.files[0]);
    }
  });
}

if (importStacks) {
  importStacks.addEventListener("click", () => {
    const rows = mappingList.querySelectorAll(".mapping-row:not(.header)");
    rows.forEach((row) => row.classList.add("imported"));
    const count = rows.length;
    blueprintStatus.textContent = `${count} blueprint row${count === 1 ? "" : "s"} staged for import in the UI prototype.`;
    statusText.textContent = "Blueprint import staged";
    importStacks.textContent = "Imported in UI";
    importStacks.disabled = true;
  });
}

async function loadBlueprintFile(file) {
  blueprintStatus.textContent = `Reading ${file.name}...`;
  statusText.textContent = "Loading blueprint";
  importStacks.disabled = true;

  const formData = new FormData();
  formData.append("blueprint", file);

  try {
    const response = await fetch("/api/blueprint/preview", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Blueprint upload failed.");
    }
    blueprintRows = payload.rows || [];
    renderBlueprintPreview(payload);
  } catch (error) {
    blueprintRows = [];
    renderEmptyMapping("Blueprint could not be loaded", error.message);
    blueprintStatus.textContent = error.message;
    statusText.textContent = "Blueprint load failed";
  }
}

function renderBlueprintPreview(payload) {
  const count = blueprintRows.length;
  const summary = blueprintMapping.querySelector(".mapping-summary");
  summary.innerHTML = `
    <strong>${escapeHtml(payload.filename)}</strong>
    <span>${count} row${count === 1 ? "" : "s"} detected from ${escapeHtml(payload.sheet || "Workbook")}</span>
  `;
  mappingList.innerHTML = `
    <div class="mapping-row header">
      <span>Blueprint row</span>
      <span>Strategy</span>
      <span>Instrument</span>
      <span>Period</span>
      <span>Attach to account</span>
    </div>
  `;

  blueprintRows.forEach((row, index) => {
    const selectedAccount = bestAccountMatch(row.account || row.raw);
    const node = document.createElement("div");
    node.className = "mapping-row";
    node.innerHTML = `
      <span>
        <strong>${escapeHtml(row.raw || `Row ${row.rowNumber}`)}</strong>
        <div class="subtle">Excel row ${row.rowNumber}${row.template ? ` · ${escapeHtml(row.template)}` : ""}</div>
      </span>
      <span>${escapeHtml(row.strategy || "Not detected")}</span>
      <span>${escapeHtml(row.instrument || "Not detected")}</span>
      <span>${escapeHtml(row.period || "Not detected")}</span>
      <select data-row-index="${index}">
        ${knownAccounts.map((account) => `<option ${account === selectedAccount ? "selected" : ""}>${escapeHtml(account)}</option>`).join("")}
      </select>
    `;
    mappingList.appendChild(node);
  });

  blueprintStatus.textContent = count
    ? `${count} blueprint row${count === 1 ? "" : "s"} ready for account mapping.`
    : "The file loaded, but no importable rows were detected.";
  importStacks.disabled = count === 0;
  importStacks.textContent = "Import Stacks";
  statusText.textContent = "Blueprint preview ready";
}

function renderEmptyMapping(title, detail) {
  const summary = blueprintMapping.querySelector(".mapping-summary");
  summary.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  mappingList.innerHTML = "";
}

function bestAccountMatch(value) {
  const normalized = String(value || "").toLowerCase();
  return knownAccounts.find((account) => normalized.includes(account.toLowerCase())) || knownAccounts[0];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

updateClock();
setInterval(updateClock, 1000);

// --- Live wiring to the Vincere Web host ---

function setStatus(message) {
  if (toolbarStatus) toolbarStatus.textContent = message;
  if (statusText) statusText.textContent = message;
}

function describe(json) {
  if (json == null) return "no response";
  if (json.blocked) return json.message || json.note || "blocked (dry-run / not approved)";
  const inner = json.result || json;
  const ok = inner.ok;
  const msg = inner.message || (json.note ?? "");
  return `${ok ? "OK" : "FAILED"}${msg ? " — " + msg : ""}`;
}

async function apiGet(path) {
  const res = await fetch(path);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function connName() {
  const el = document.querySelector("#connName");
  return (el && el.value.trim()) || "";
}

async function loadAccounts() {
  const panel = document.querySelector("#accountList");
  try {
    const data = await apiGet("/api/accounts");
    knownAccounts = (data.accounts || []).map((a) => a.displayName);
    if (panel) {
      const heading = "<h1>Accounts</h1>";
      const rows = (data.accounts || [])
        .map((a, i) => `<button class="account-row${i === 0 ? " active" : ""}">${escapeHtml(a.displayName)} <span class="subtle">${escapeHtml(a.accountMasked)}</span></button>`)
        .join("");
      panel.innerHTML = heading + (rows || '<p class="subtle">No accounts yet. Import a blueprint or scan NinjaTrader.</p>');
    }
  } catch (error) {
    if (panel) panel.innerHTML = `<h1>Accounts</h1><p class="subtle">Could not load accounts: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadSchedule() {
  try {
    const s = await apiGet("/api/schedule");
    const enabled = document.querySelector("#scheduleEnabled");
    const time = document.querySelector("#scheduleTime");
    const enableStrats = document.querySelector("#scheduleEnableStrategies");
    if (enabled) enabled.checked = !!s.enabled;
    if (time && s.time) time.value = s.time;
    if (enableStrats) enableStrats.checked = !!s.enableStrategies;
  } catch (error) {
    /* leave defaults */
  }
}

function bindClick(id, handler) {
  const el = document.querySelector(id);
  if (el) el.addEventListener("click", handler);
}

bindClick("#testIpc", async () => {
  setStatus("Pinging NinjaTrader add-on…");
  setStatus("Test IPC: " + describe(await apiGet("/api/ping")));
});

bindClick("#connectFirms", async () => {
  const name = connName();
  if (!name) return setStatus("Enter a connection name first.");
  setStatus(`Connecting ${name}…`);
  setStatus(`Connect ${name}: ` + describe(await apiPost(`/api/connections/${encodeURIComponent(name)}/connect`)));
});

bindClick("#disconnectFirms", async () => {
  const name = connName();
  if (!name) return setStatus("Enter a connection name first.");
  setStatus(`Disconnecting ${name}…`);
  setStatus(`Disconnect ${name}: ` + describe(await apiPost(`/api/connections/${encodeURIComponent(name)}/disconnect`)));
});

bindClick("#disableAlgos", async () => {
  setStatus("Disabling all strategies…");
  setStatus("Disable all: " + describe(await apiPost("/api/strategies/disable-all")));
});

bindClick("#enableAlgos", async () => {
  setStatus("Enable all (guarded)…");
  // No confirm token sent: stays in dry-run/blocked unless the host is approved for live.
  setStatus("Enable all: " + describe(await apiPost("/api/strategies/enable-all", {})));
});

bindClick("#saveSchedule", async () => {
  const enabled = document.querySelector("#scheduleEnabled")?.checked ?? false;
  const time = document.querySelector("#scheduleTime")?.value.trim();
  const enableStrategies = document.querySelector("#scheduleEnableStrategies")?.checked ?? false;
  const scheduleStatus = document.querySelector("#scheduleStatus");
  const result = await apiPost("/api/schedule", { enabled, time, enableStrategies });
  if (scheduleStatus) {
    scheduleStatus.textContent = result.ok
      ? `Saved. Schedule ${result.enabled ? "armed" : "disarmed"} for ${result.time} ${result.timezone}. Enable strategies: ${result.enableStrategies}.`
      : result.message || "Save failed.";
  }
  loadSchedule();
});

bindClick("#runReady", async () => {
  const scheduleStatus = document.querySelector("#scheduleStatus");
  if (scheduleStatus) scheduleStatus.textContent = "Running Get Algos Ready…";
  const result = await apiPost("/api/ready/run", {});
  if (scheduleStatus) scheduleStatus.textContent = "Get Algos Ready: " + describe(result);
});

loadAccounts();
loadSchedule();
