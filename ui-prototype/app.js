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

const knownAccounts = ["LFE0506703503008", "LFE0506703503010", "Lucid Trading #4", "Sim101"];
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
