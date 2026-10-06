// popup.js — Rashmi AI settings

const apiKeyInput    = document.getElementById("api-key-input");
const eyeBtn         = document.getElementById("eye-btn");
const testBtn        = document.getElementById("test-btn");
const keyHint        = document.getElementById("key-hint");
const modelSelect    = document.getElementById("model-select");
const saveBtn        = document.getElementById("save-btn");
const statusBanner   = document.getElementById("status-banner");
const statusIcon     = document.getElementById("status-icon");
const statusTitle    = document.getElementById("status-title");
const statusDetail   = document.getElementById("status-detail");
const advancedToggle = document.getElementById("advanced-toggle");
const advancedBody   = document.getElementById("advanced-body");
const chevron        = document.getElementById("chevron");
const proxyUrlInput  = document.getElementById("proxy-url-input");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/models";

// ── Load saved settings ───────────────────────────────────────────────────────
chrome.storage.local
  .get(["anthropicApiKey", "model", "proxyUrl"])
  .then(({ anthropicApiKey, model, proxyUrl }) => {
    if (anthropicApiKey) {
      apiKeyInput.value = anthropicApiKey;
      validateKeyFormat(anthropicApiKey);
    }
    if (model) modelSelect.value = model;
    if (proxyUrl) proxyUrlInput.value = proxyUrl;

    // Show initial status based on stored key
    if (anthropicApiKey && anthropicApiKey.startsWith("sk-ant-")) {
      setStatus("ready", "API key saved", "Click Test to verify it's working.");
    } else if (anthropicApiKey) {
      setStatus("error", "Invalid key format", "Anthropic keys start with sk-ant-…");
    } else {
      setStatus("idle", "No API key yet", "Enter your key below to get started.");
    }
  });

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(type, title, detail) {
  const icons = { ready: "🟢", error: "🔴", saving: "🔵", idle: "⏳" };
  statusBanner.className = `status-banner ${type === "idle" ? "" : type}`.trim();
  statusIcon.textContent  = icons[type] || "⏳";
  statusTitle.textContent  = title;
  statusDetail.textContent = detail;
}

// ── Key format validation (visual only, no network) ───────────────────────────
function validateKeyFormat(val) {
  apiKeyInput.classList.remove("valid", "invalid");
  if (!val) { keyHint.textContent = "Enter your Anthropic API key — stored locally only."; return; }
  if (val.startsWith("sk-ant-")) {
    apiKeyInput.classList.add("valid");
    keyHint.textContent = "✓ Key format looks good";
  } else {
    apiKeyInput.classList.add("invalid");
    keyHint.textContent = "⚠ Anthropic keys start with sk-ant-…";
  }
}

apiKeyInput.addEventListener("input", () => validateKeyFormat(apiKeyInput.value.trim()));

// ── Show/hide password ────────────────────────────────────────────────────────
eyeBtn.addEventListener("click", () => {
  const isHidden = apiKeyInput.type === "password";
  apiKeyInput.type = isHidden ? "text" : "password";
  eyeBtn.textContent = isHidden ? "🙈" : "👁";
});

// ── Test API key ──────────────────────────────────────────────────────────────
testBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { setStatus("error", "No key entered", "Paste your Anthropic key first."); return; }
  if (!key.startsWith("sk-ant-")) {
    setStatus("error", "Invalid format", "Anthropic keys start with sk-ant-…"); return;
  }

  testBtn.disabled = true;
  testBtn.textContent = "…";
  setStatus("saving", "Testing key…", "Making a request to Anthropic");

  try {
    const res = await fetch(ANTHROPIC_URL, {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });

    if (res.ok) {
      setStatus("ready", "Key is valid ✓", "Your API key works. Save to continue.");
      apiKeyInput.classList.remove("invalid");
      apiKeyInput.classList.add("valid");
    } else if (res.status === 401) {
      setStatus("error", "Invalid key", "This key was rejected by Anthropic.");
      apiKeyInput.classList.add("invalid");
    } else {
      setStatus("error", `API error ${res.status}`, "Check Anthropic status page.");
    }
  } catch {
    setStatus("error", "Network error", "Could not reach Anthropic. Check your connection.");
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "Test";
  }
});

// ── Save settings ─────────────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  const key      = apiKeyInput.value.trim();
  const model    = modelSelect.value;
  const proxyUrl = proxyUrlInput.value.trim();

  if (!key) {
    setStatus("error", "API key required", "Please enter your Anthropic API key.");
    apiKeyInput.focus();
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  await chrome.storage.local.set({
    anthropicApiKey: key,
    model,
    proxyUrl: proxyUrl || null,
  });

  setStatus("ready", "Settings saved ✓", `Model: ${model}`);
  saveBtn.disabled = false;
  saveBtn.textContent = "Save Settings";
});

// ── Advanced toggle ───────────────────────────────────────────────────────────
advancedToggle.addEventListener("click", () => {
  const isOpen = advancedBody.classList.toggle("open");
  chevron.classList.toggle("open", isOpen);
});
