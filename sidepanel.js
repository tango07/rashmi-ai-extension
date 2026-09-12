// sidepanel.js

// ── Element refs ──────────────────────────────────────────────────────────────
const messagesEl    = document.getElementById("messages");
const inputEl       = document.getElementById("user-input");
const sendBtn       = document.getElementById("send-btn");
const clearBtn      = document.getElementById("clear-btn");
const settingsBtn   = document.getElementById("settings-btn");
const newChatBtn    = document.getElementById("new-chat-btn");
const thinkBtn      = document.getElementById("think-btn");
const scanBtn       = document.getElementById("scan-btn");
const contextText   = document.getElementById("context-text");
const suggestions   = document.querySelectorAll(".suggestion-chip");
const tabChat       = document.getElementById("tab-chat");
const tabHistory    = document.getElementById("tab-history");
const chatView      = document.getElementById("chat-view");
const historyView   = document.getElementById("history-view");
const historyList   = document.getElementById("history-list");
const historyCount  = document.getElementById("history-count");
const clearAllBtn   = document.getElementById("clear-all-btn");
const contextBanner = document.getElementById("context-banner");
const darkBtn            = document.getElementById("dark-btn");
const exportBtn          = document.getElementById("export-btn");
const historySearch      = document.getElementById("history-search");
const fontSmBtn          = document.getElementById("font-sm-btn");
const fontMdBtn          = document.getElementById("font-md-btn");
const fontLgBtn          = document.getElementById("font-lg-btn");
const voiceBtn           = document.getElementById("voice-btn");
const screenshotBtn      = document.getElementById("screenshot-btn");
const screenshotPreviewWrap = document.getElementById("screenshot-preview-wrap");
const screenshotPreview  = document.getElementById("screenshot-preview");
const screenshotRemoveBtn = document.getElementById("screenshot-remove-btn");
const usageBar           = document.getElementById("usage-bar");
const pinBtn             = document.getElementById("pin-btn");
const templateBtn        = document.getElementById("template-btn");
const templateDropdown   = document.getElementById("template-dropdown");
const tplList            = document.getElementById("tpl-list");
const tplNewBtn          = document.getElementById("tpl-new-btn");
const tplAddForm         = document.getElementById("tpl-add-form");
const tplNameInput       = document.getElementById("tpl-name-input");
const tplPromptInput     = document.getElementById("tpl-prompt-input");
const tplSaveBtn         = document.getElementById("tpl-save-btn");
const tplCancelBtn       = document.getElementById("tpl-cancel-btn");

// ── State ─────────────────────────────────────────────────────────────────────
let history          = [];
let pageContext      = null;
let pinnedPages      = [];   // multi-page context
let currentSessionId = null;
let thinkingEnabled  = false;
let isStreaming      = false;
let pendingScreenshot = null; // { dataUrl, base64 }
let sessionInputTokens  = 0;
let sessionOutputTokens = 0;
const MAX_SESSIONS   = 100;

// Token pricing per 1M tokens (approximate)
const PRICING = {
  "claude-haiku-4-5":  { input: 0.80,  output: 4.00  },
  "claude-sonnet-4-5": { input: 3.00,  output: 15.00 },
  "claude-opus-4-5":   { input: 15.00, output: 75.00 },
};

// ── Settings button — turns red when no API key ───────────────────────────────
async function checkApiKeyStatus() {
  const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
  const hasKey = anthropicApiKey && anthropicApiKey.startsWith("sk-ant-");
  settingsBtn.classList.toggle("needs-key", !hasKey);
}

chrome.storage.onChanged.addListener((changes) => {
  if ("anthropicApiKey" in changes) checkApiKeyStatus();
});

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
}

settingsBtn.addEventListener("click", openSettings);
checkApiKeyStatus();

// ── Dark mode ─────────────────────────────────────────────────────────────────
(async () => {
  const { darkMode } = await chrome.storage.local.get("darkMode");
  if (darkMode) { document.body.classList.add("dark"); darkBtn.textContent = "☀️"; }
})();

darkBtn.addEventListener("click", async () => {
  const isDark = document.body.classList.toggle("dark");
  darkBtn.textContent = isDark ? "☀️" : "🌙";
  await chrome.storage.local.set({ darkMode: isDark });
});

// ── Font size ─────────────────────────────────────────────────────────────────
const fontBtns = { sm: fontSmBtn, md: fontMdBtn, lg: fontLgBtn };

function setFontSize(size) {
  messagesEl.classList.remove("font-sm", "font-md", "font-lg");
  messagesEl.classList.add(`font-${size}`);
  Object.entries(fontBtns).forEach(([k, btn]) => btn.classList.toggle("active", k === size));
  chrome.storage.local.set({ fontSize: size });
}

(async () => {
  const { fontSize } = await chrome.storage.local.get("fontSize");
  setFontSize(fontSize || "md");
})();

fontSmBtn.addEventListener("click", () => setFontSize("sm"));
fontMdBtn.addEventListener("click", () => setFontSize("md"));
fontLgBtn.addEventListener("click", () => setFontSize("lg"));

// ── Export chat ───────────────────────────────────────────────────────────────
exportBtn.addEventListener("click", () => {
  if (history.length === 0) { alert("Nothing to export yet."); return; }
  const lines = history.map((m) =>
    `## ${m.role === "user" ? "You" : "Claude"}\n\n${m.content}`
  );
  const md = `# Chat Export\n_${new Date().toLocaleString()}_\n\n---\n\n${lines.join("\n\n---\n\n")}`;
  const blob = new Blob([md], { type: "text/markdown" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `claude-chat-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Voice input (runs via content script — Speech API needs page context) ─────
let isVoiceRecording = false;

function stopVoiceUI() {
  isVoiceRecording = false;
  voiceBtn.classList.remove("recording");
  voiceBtn.textContent = "🎤";
}

voiceBtn.addEventListener("click", async () => {
  if (isVoiceRecording) {
    // Stop recording
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "STOP_VOICE" }).catch(() => {});
    stopVoiceUI();
    return;
  }

  // Start recording
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { alert("No active tab found."); return; }

  isVoiceRecording = true;
  voiceBtn.classList.add("recording");
  voiceBtn.textContent = "⏹";

  chrome.tabs.sendMessage(tab.id, { type: "START_VOICE" }, (resp) => {
    if (chrome.runtime.lastError || resp?.ok === false) {
      stopVoiceUI();
      const reason = resp?.error === "not_supported"
        ? "Speech recognition is not supported in this browser."
        : "Could not start voice input on this page.";
      alert(reason);
    }
  });
});

// ── Screenshot + ask ──────────────────────────────────────────────────────────
screenshotBtn.addEventListener("click", async () => {
  screenshotBtn.textContent = "⏳";
  screenshotBtn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
    if (resp.ok) {
      pendingScreenshot = { dataUrl: resp.dataUrl, base64: resp.dataUrl.split(",")[1] };
      screenshotPreview.src = resp.dataUrl;
      screenshotPreviewWrap.style.display = "block";
      inputEl.placeholder = "Ask about this screenshot…";
      inputEl.focus();
    } else {
      alert("Screenshot failed: " + resp.error);
    }
  } catch (err) { alert("Screenshot error: " + err.message); }
  finally { screenshotBtn.textContent = "📸"; screenshotBtn.disabled = false; }
});

screenshotRemoveBtn.addEventListener("click", () => {
  pendingScreenshot = null;
  screenshotPreviewWrap.style.display = "none";
  screenshotPreview.src = "";
  inputEl.placeholder = "Ask about this page…";
});

// ── Usage tracker ─────────────────────────────────────────────────────────────
function updateUsageDisplay(model) {
  if (sessionInputTokens === 0 && sessionOutputTokens === 0) return;
  usageBar.style.display = "block";
  const total = sessionInputTokens + sessionOutputTokens;
  const pricing = PRICING[model] || PRICING["claude-sonnet-4-5"];
  const cost = (sessionInputTokens / 1e6 * pricing.input) +
               (sessionOutputTokens / 1e6 * pricing.output);
  usageBar.textContent =
    `Session: ${total.toLocaleString()} tokens · ~$${cost.toFixed(4)}`;
}

// ── Multi-page context (pinned pages) ─────────────────────────────────────────
function updatePinButton() {
  const count = pinnedPages.length;
  const isCurrentPinned = pageContext?.url && pinnedPages.some((p) => p.url === pageContext.url);

  if (count === 0) {
    pinBtn.textContent = "📌 Pin";
    pinBtn.classList.remove("pinned");
    pinBtn.title = "Pin this page to context (keep it in Claude's memory as you browse)";
  } else if (isCurrentPinned) {
    pinBtn.textContent = `📌 ${count} ✓`;
    pinBtn.classList.add("pinned");
    pinBtn.title = `${count} page(s) pinned — this page is included. Click to unpin it.`;
  } else {
    pinBtn.textContent = `📌 ${count}`;
    pinBtn.classList.add("pinned");
    pinBtn.title = `${count} page(s) pinned — click to also pin this page`;
  }
}

pinBtn.addEventListener("click", () => {
  if (!pageContext?.text) { alert("No page scanned yet. Click ⟳ Scan first."); return; }

  const idx = pinnedPages.findIndex((p) => p.url === pageContext.url);
  if (idx !== -1) {
    // Already pinned → remove it
    pinnedPages.splice(idx, 1);
  } else {
    // Not pinned yet → add it (max 5 pages)
    if (pinnedPages.length >= 5) { alert("Maximum 5 pages can be pinned at once."); return; }
    pinnedPages.push({ title: pageContext.title, url: pageContext.url, text: pageContext.text });
  }
  updatePinButton();
});

// ── Thinking toggle ───────────────────────────────────────────────────────────
thinkBtn.addEventListener("click", () => {
  thinkingEnabled = !thinkingEnabled;
  thinkBtn.classList.toggle("active", thinkingEnabled);
  thinkBtn.title = thinkingEnabled
    ? "Extended thinking ON (uses Sonnet/Opus)"
    : "Toggle extended thinking (Sonnet/Opus only)";
});

// ── Tab switching ─────────────────────────────────────────────────────────────
tabChat.addEventListener("click", () => {
  tabChat.classList.add("active");
  tabHistory.classList.remove("active");
  chatView.style.display = "flex";
  historyView.classList.remove("active");
  contextBanner.style.display = "flex";
});

tabHistory.addEventListener("click", () => {
  tabHistory.classList.add("active");
  tabChat.classList.remove("active");
  chatView.style.display = "none";
  historyView.classList.add("active");
  contextBanner.style.display = "none";
  renderHistory();
});

// ── Page context ──────────────────────────────────────────────────────────────
async function loadPageContext() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" });
    if (resp.ok && resp.context) {
      pageContext = resp.context;
      const chars = pageContext.text?.length || 0;
      contextText.textContent = `📄 ${pageContext.title || pageContext.url} (${chars.toLocaleString()} chars)`;
    } else {
      contextText.textContent = "⚠️ No page scanned — click ⟳ Scan";
    }
    updatePinButton();
  } catch {
    contextText.textContent = "⚠️ Could not reach content script";
  }
}

loadPageContext();
checkPendingPrompt();
checkPendingChatInject();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadPageContext();
    checkPendingPrompt();
    checkPendingChatInject();
  }
});

// ── Pending prompt (triggered by contextual page buttons) ─────────────────
async function checkPendingPrompt() {
  try {
    const { pendingPrompt } = await chrome.storage.session.get("pendingPrompt");
    if (!pendingPrompt) return;
    await chrome.storage.session.remove("pendingPrompt");
    setTimeout(() => sendMessage(pendingPrompt), 400);
  } catch { /* session storage unavailable */ }
}

// ── Pending chat inject (triggered by "Add to chat" in float panel) ────────
async function checkPendingChatInject() {
  try {
    const { pendingChatInject } = await chrome.storage.session.get("pendingChatInject");
    if (!pendingChatInject) return;
    await chrome.storage.session.remove("pendingChatInject");
    setTimeout(() => injectChatTurn(pendingChatInject.userMessage, pendingChatInject.assistantMessage), 400);
  } catch { /* session storage unavailable */ }
}

// Injects a user + assistant turn into the chat and focuses the input
function injectChatTurn(userMessage, assistantMessage) {
  clearEmptyState();
  // Switch to chat tab if on history
  tabChat.click();

  // Add to in-memory history
  history.push({ role: "user",      content: userMessage });
  history.push({ role: "assistant", content: assistantMessage });

  // Render both messages
  appendMessage("user", userMessage);
  appendMessage("assistant", assistantMessage);

  // Save and focus
  saveCurrentSession();
  inputEl.focus();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

chrome.runtime.onMessage.addListener((message) => {
  // Voice results relayed from content script
  if (message.type === "VOICE_RESULT") {
    inputEl.value = message.transcript;
    autoResizeInput();
    return;
  }
  if (message.type === "VOICE_END") {
    stopVoiceUI();
    return;
  }

  // Direct prompt injection from page buttons (panel already open path)
  if (message.type === "INJECT_PROMPT") {
    setTimeout(() => sendMessage(message.prompt), 300);
    return;
  }

  // Inject a completed float-panel conversation into the chat.
  // Guard: only process the flat format forwarded by background.js.
  // The original message from content.js arrives here too (nested in .payload)
  // and must be ignored — otherwise userMessage/assistantMessage are undefined.
  if (message.type === "INJECT_CHAT") {
    if (message.userMessage && message.assistantMessage) {
      injectChatTurn(message.userMessage, message.assistantMessage);
    }
    return;
  }

  if (message.type === "SCAN_STATUS") {
    scanBtn.disabled = false;
    scanBtn.classList.remove("scanning");
    scanBtn.textContent = "⟳ Scan";
    if (message.payload.status === "ok") {
      const { source, title, chars, pages } = message.payload;
      let icon = "✅", label = "page";
      if (source === "transcript") { icon = "🎬"; label = "transcript"; }
      if (source === "pdf")        { icon = "📄"; label = `PDF (${pages} page${pages !== 1 ? "s" : ""})`; }
      contextText.textContent = `${icon} Scanned ${label}: ${title} (${chars.toLocaleString()} chars)`;
      loadPageContext();
    } else {
      contextText.textContent = `⚠️ ${message.payload.message}`;
    }
  }
  if (message.type === "SET_PAGE_CONTEXT") loadPageContext();
});

scanBtn.addEventListener("click", async () => {
  scanBtn.textContent = "Scanning…";
  scanBtn.disabled = true;
  scanBtn.classList.add("scanning");
  contextText.textContent = "Scanning page…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    await chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SCAN" });
    setTimeout(async () => {
      if (scanBtn.disabled) {
        scanBtn.disabled = false;
        scanBtn.classList.remove("scanning");
        scanBtn.textContent = "⟳ Scan";
        await loadPageContext();
      }
    }, 3000);
  } catch (err) {
    scanBtn.disabled = false;
    scanBtn.classList.remove("scanning");
    scanBtn.textContent = "⟳ Scan";
    contextText.textContent = `⚠️ Scan failed: ${err.message}`;
  }
});

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const base =
    "Your name is Rashmi. You are a smart, friendly AI browsing assistant. " +
    "You help users understand and interact with the content of any webpage — " +
    "answering questions, explaining concepts, summarising content, and helping with quizzes or tasks. " +
    "Always refer to yourself as Rashmi. Be warm, concise, and genuinely helpful.";

  let prompt = base;

  // Add pinned pages first (older context)
  if (pinnedPages.length > 0) {
    const pinned = pinnedPages.map((p, i) =>
      `\n\n--- Pinned page ${i + 1}: "${p.title || p.url}" ---\n${p.text.slice(0, 4000)}`
    ).join("");
    prompt += "\n\nThe user has pinned the following pages for context:" + pinned;
  }

  // Add current page context
  if (pageContext?.text) {
    prompt += `\n\nCurrent page: "${pageContext.title || pageContext.url}"\n\nContent:\n${pageContext.text.slice(0, 8000)}`;
  }

  return prompt;
}

// ── Send message (streaming) ──────────────────────────────────────────────────
async function sendMessage(userText) {
  userText = userText.trim();
  if (!userText || isStreaming) return;

  clearEmptyState();

  // Build the user message (may include an image content block)
  let userHistoryEntry;
  if (pendingScreenshot) {
    // Show a user bubble with a thumbnail + text
    const userBubble = document.createElement("div");
    userBubble.className = "msg user";
    const img = document.createElement("img");
    img.src = pendingScreenshot.dataUrl;
    img.style.cssText = "max-width:100%;border-radius:6px;display:block;margin-bottom:6px;";
    userBubble.appendChild(img);
    userBubble.appendChild(document.createTextNode(userText));
    messagesEl.appendChild(userBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Vision content block for the API
    userHistoryEntry = {
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: pendingScreenshot.base64 },
        },
        { type: "text", text: userText },
      ],
    };

    // Clear the screenshot preview
    pendingScreenshot = null;
    screenshotPreviewWrap.style.display = "none";
    screenshotPreview.src = "";
    inputEl.placeholder = "Ask about this page…";
  } else {
    appendMessage("user", userText);
    userHistoryEntry = { role: "user", content: userText };
  }

  history.push(userHistoryEntry);

  inputEl.value = "";
  autoResizeInput();
  sendBtn.disabled = true;
  isStreaming = true;

  const { model } = await chrome.storage.local.get("model");

  // Elements we'll populate during streaming
  let thinkingBlock = null;
  let thinkingBodyEl = null;
  let thinkingText = "";
  let thinkingSpinner = null;
  let assistantMsgEl = null;
  let assistantText = "";
  let inThinking = false;
  let inText = false;

  // Open a long-lived port to the background service worker
  const port = chrome.runtime.connect({ name: "claude-stream" });

  port.onMessage.addListener((msg) => {
    if (msg.type === "THINKING_START") {
      inThinking = true;
      thinkingBlock = createThinkingBlock();
      thinkingBodyEl = thinkingBlock.querySelector(".thinking-body");
      thinkingSpinner = thinkingBlock.querySelector(".thinking-spinner");
      messagesEl.appendChild(thinkingBlock);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (msg.type === "THINKING_CHUNK" && thinkingBodyEl) {
      thinkingText += msg.text;
      thinkingBodyEl.textContent = thinkingText;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (msg.type === "TEXT_START") {
      inThinking = false;
      inText = true;
      // Stop spinner on thinking block
      if (thinkingSpinner) {
        thinkingSpinner.style.animation = "none";
        thinkingSpinner.style.borderTopColor = "#c4b5fd";
      }
      // Update thinking header label
      if (thinkingBlock) {
        const label = thinkingBlock.querySelector(".thinking-toggle");
        if (label) label.textContent = "▼ collapse";
        const headerTitle = thinkingBlock.querySelector(".thinking-title");
        if (headerTitle) headerTitle.textContent = "🧠 Reasoning";
      }
      // Create the assistant message bubble
      assistantMsgEl = document.createElement("div");
      assistantMsgEl.className = "msg assistant streaming";
      messagesEl.appendChild(assistantMsgEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (msg.type === "TEXT_CHUNK" && assistantMsgEl) {
      assistantText += msg.text;
      assistantMsgEl.textContent = assistantText;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (msg.type === "TOKEN_USAGE") {
      sessionInputTokens  += msg.inputTokens  || 0;
      sessionOutputTokens += msg.outputTokens || 0;
    }

    if (msg.type === "STREAM_END") {
      // Re-render plain streamed text as formatted markdown
      if (assistantMsgEl) {
        assistantMsgEl.classList.remove("streaming");
        renderAsMarkdown(assistantMsgEl, assistantText);
      }

      // Push to history and save
      if (assistantText) {
        history.push({ role: "assistant", content: assistantText });
        saveCurrentSession();
      }

      // Update token/cost display
      updateUsageDisplay(model || "claude-sonnet-4-5");

      port.disconnect();
      sendBtn.disabled = false;
      isStreaming = false;
      inputEl.focus();
    }

    if (msg.type === "STREAM_ERROR") {
      // If we got partial text, keep it but show error below
      if (assistantMsgEl) assistantMsgEl.classList.remove("streaming");

      const errEl = document.createElement("div");
      errEl.className = "msg error";
      errEl.textContent = `❌ ${msg.error}`;
      messagesEl.appendChild(errEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      port.disconnect();
      sendBtn.disabled = false;
      isStreaming = false;
      inputEl.focus();
    }

    // Handle case where TEXT_CHUNK arrives with no TEXT_START (non-thinking direct stream)
    if (msg.type === "TEXT_CHUNK" && !inText && !assistantMsgEl) {
      inText = true;
      assistantMsgEl = document.createElement("div");
      assistantMsgEl.className = "msg assistant streaming";
      messagesEl.appendChild(assistantMsgEl);
      assistantText += msg.text;
      assistantMsgEl.textContent = assistantText;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  port.onDisconnect.addListener(() => {
    if (isStreaming) {
      sendBtn.disabled = false;
      isStreaming = false;
      if (assistantMsgEl) assistantMsgEl.classList.remove("streaming");
    }
  });

  // Start the stream
  port.postMessage({
    type: "START_STREAM",
    payload: {
      messages: history,
      systemPrompt: buildSystemPrompt(),
      model: model || "claude-sonnet-4-5",
      thinking: thinkingEnabled,
    },
  });
}

// ── Thinking block DOM builder ────────────────────────────────────────────────
function createThinkingBlock() {
  const block = document.createElement("div");
  block.className = "thinking-block";
  block.innerHTML = `
    <div class="thinking-header">
      <div class="thinking-spinner"></div>
      <span class="thinking-title">🧠 Thinking…</span>
      <span class="thinking-toggle">▼ collapse</span>
    </div>
    <div class="thinking-body"></div>
  `;

  let collapsed = false;
  block.querySelector(".thinking-header").addEventListener("click", () => {
    collapsed = !collapsed;
    block.querySelector(".thinking-body").classList.toggle("collapsed", collapsed);
    block.querySelector(".thinking-toggle").textContent = collapsed ? "▶ expand" : "▼ collapse";
  });

  return block;
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function markdownToHtml(md) {
  // 1. Extract fenced code blocks into placeholders so we can HTML-escape the rest safely
  const codeBlocks = [];
  let processed = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "text", code });
    return `\x00CODE${idx}\x00`;
  });

  // 2. Escape HTML in the non-code parts
  processed = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 3. Inline formatting (order matters: bold before italic)
  processed = processed
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  // 4. Headers
  processed = processed
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm,  "<h3>$1</h3>")
    .replace(/^# (.+)$/gm,   "<h3>$1</h3>");

  // 5. Lists (simple single-level)
  processed = processed
    .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/^\s*\d+\. (.+)$/gm, "<li>$1</li>");
  // Wrap consecutive <li> runs in <ul>
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // 6. Paragraphs (blank lines → paragraph breaks)
  processed = processed
    .split(/\n{2,}/)
    .map((block) => {
      block = block.trim();
      if (!block) return "";
      // Don't wrap blocks that are already block-level HTML
      if (/^<(h[34]|ul|ol|li|pre|div)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  // 7. Restore code blocks as styled wrappers with copy buttons
  processed = processed.replace(/\x00CODE(\d+)\x00/g, (_, idx) => {
    const { lang, code } = codeBlocks[idx];
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeCode = encodeURIComponent(code);
    return `<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang">${lang}</span>
    <button class="copy-code-btn" data-code="${safeCode}">📋 Copy</button>
  </div>
  <pre><code>${escaped}</code></pre>
</div>`;
  });

  return processed;
}

// Event delegation for code-block copy buttons (avoids inline onclick — CSP violation)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-code-btn");
  if (!btn) return;
  const code = decodeURIComponent(btn.dataset.code);
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "✓ Copied!";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "📋 Copy"; btn.classList.remove("copied"); }, 1500);
  });
});

// Re-render a streamed message bubble as markdown after streaming ends
function renderAsMarkdown(el, plainText) {
  // Remove the streaming-plain textContent, replace with rendered HTML + copy button
  el.textContent = ""; // clear
  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-copy-btn";
  copyBtn.innerHTML = "📋 Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(plainText).then(() => {
      copyBtn.innerHTML = "✓ Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { copyBtn.innerHTML = "📋 Copy"; copyBtn.classList.remove("copied"); }, 1500);
    });
  });
  el.appendChild(copyBtn);

  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = markdownToHtml(plainText);
  el.appendChild(body);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function appendMessage(type, text) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  if (type === "assistant") {
    // Render assistant messages as markdown immediately (used for history loads)
    renderAsMarkdown(div, text);
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function clearEmptyState() {
  messagesEl.querySelector(".empty-state")?.remove();
}

function autoResizeInput() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + "px";
}

// ── History ───────────────────────────────────────────────────────────────────
async function getSessions() {
  const { chatHistory } = await chrome.storage.local.get("chatHistory");
  return chatHistory || [];
}
async function saveSessions(sessions) {
  await chrome.storage.local.set({ chatHistory: sessions });
}

async function saveCurrentSession() {
  if (history.length === 0) return;
  const sessions = await getSessions();
  const title = history[0]?.content?.slice(0, 60) || "Untitled chat";
  const lastMsg = history[history.length - 1]?.content?.slice(0, 80) || "";

  if (currentSessionId) {
    const idx = sessions.findIndex((s) => s.id === currentSessionId);
    if (idx !== -1) {
      sessions[idx].messages = [...history];
      sessions[idx].updatedAt = new Date().toISOString();
      sessions[idx].lastMessage = lastMsg;
    }
  } else {
    currentSessionId = Date.now();
    sessions.unshift({
      id: currentSessionId, title,
      pageTitle: pageContext?.title || "",
      url: pageContext?.url || "",
      messages: [...history],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessage: lastMsg,
    });
  }
  if (sessions.length > MAX_SESSIONS) sessions.splice(MAX_SESSIONS);
  await saveSessions(sessions);
}

async function deleteSession(id) {
  const sessions = await getSessions();
  await saveSessions(sessions.filter((s) => s.id !== id));
  if (currentSessionId === id) { currentSessionId = null; history = []; }
  renderHistory();
}

// Live search filtering
historySearch.addEventListener("input", () => renderHistory());

async function renderHistory() {
  const sessions = await getSessions();
  const query = historySearch.value.trim().toLowerCase();
  const filtered = query
    ? sessions.filter((s) =>
        s.title?.toLowerCase().includes(query) ||
        s.lastMessage?.toLowerCase().includes(query) ||
        s.messages?.some((m) => m.content?.toLowerCase().includes(query))
      )
    : sessions;

  historyCount.textContent = query
    ? `${filtered.length}/${sessions.length}`
    : `${sessions.length}`;

  if (filtered.length === 0) {
    historyList.innerHTML = query
      ? `<div class="history-empty"><div class="icon">🔍</div><p>No results for "${escapeHtml(query)}"</p></div>`
      : `<div class="history-empty"><div class="icon">🕓</div><p>No chat history yet.<br>Start a conversation!</p></div>`;
    return;
  }
  historyList.innerHTML = "";
  filtered.forEach((session) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const date = new Date(session.updatedAt || session.createdAt);
    const msgCount = Math.floor((session.messages?.length || 0) / 2);
    item.innerHTML = `
      <div class="history-item-body">
        <div class="history-item-title">${escapeHtml(session.title)}</div>
        <div class="history-item-meta">
          <span>🕓 ${formatDate(date)}</span>
          <span>💬 ${msgCount} exchange${msgCount !== 1 ? "s" : ""}</span>
        </div>
        ${session.lastMessage ? `<div class="history-item-preview">${escapeHtml(session.lastMessage)}</div>` : ""}
      </div>
      <button class="history-delete-btn" title="Delete">✕</button>`;

    item.querySelector(".history-item-body").addEventListener("click", () => loadSession(session));
    item.querySelector(".history-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this conversation?")) deleteSession(session.id);
    });
    historyList.appendChild(item);
  });
}

function loadSession(session) {
  history = [...session.messages];
  currentSessionId = session.id;
  tabChat.click();
  messagesEl.innerHTML = "";
  const banner = document.createElement("div");
  banner.style.cssText = "text-align:center;font-size:11px;color:#9ca3af;padding:6px;";
  banner.textContent = `— Loaded from history · ${formatDate(new Date(session.createdAt))} —`;
  messagesEl.appendChild(banner);
  history.forEach((msg) => appendMessage(msg.role === "user" ? "user" : "assistant", msg.content));
}

function startNewChat() {
  history = [];
  currentSessionId = null;
  sessionInputTokens  = 0;
  sessionOutputTokens = 0;
  usageBar.style.display = "none";
  usageBar.textContent   = "";
  messagesEl.innerHTML = `
    <div class="empty-state">
      <div class="icon">✨</div>
      <strong>Hi, I'm Rashmi 👋</strong>
      <p style="margin-top:6px">Navigate to any webpage, click<br>⟳ Scan, then ask me anything.</p>
    </div>`;
  inputEl.focus();
  tabChat.click();
}

// ── Event listeners ───────────────────────────────────────────────────────────
newChatBtn.addEventListener("click", startNewChat);
clearBtn.addEventListener("click", startNewChat);
clearAllBtn.addEventListener("click", async () => {
  if (confirm("Delete all chat history? This cannot be undone.")) {
    await saveSessions([]);
    currentSessionId = null;
    renderHistory();
  }
});

sendBtn.addEventListener("click", () => sendMessage(inputEl.value));
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); }
});
inputEl.addEventListener("input", autoResizeInput);
suggestions.forEach((chip) => chip.addEventListener("click", () => sendMessage(chip.dataset.prompt)));

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatDate(date) {
  const diff = Date.now() - date;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Prompt Templates ──────────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  { id: "tpl-1", name: "Summarise page",       prompt: "Please give me a concise summary of this page in 3-5 bullet points." },
  { id: "tpl-2", name: "Explain like I'm 5",   prompt: "Explain the main topic of this page as if I'm 5 years old, using simple words and an analogy." },
  { id: "tpl-3", name: "Key concepts",          prompt: "What are the 5 most important concepts on this page? List each with a brief explanation." },
  { id: "tpl-4", name: "Practice questions",    prompt: "Generate 5 practice questions based on this content, along with the answers." },
  { id: "tpl-5", name: "Pros and cons",         prompt: "What are the main pros and cons discussed or implied on this page? Format as two lists." },
];

async function loadTemplates() {
  const { promptTemplates } = await chrome.storage.local.get("promptTemplates");
  if (!promptTemplates) {
    // First run — seed with defaults
    await chrome.storage.local.set({ promptTemplates: DEFAULT_TEMPLATES });
    return DEFAULT_TEMPLATES;
  }
  return promptTemplates;
}

async function saveTemplates(templates) {
  await chrome.storage.local.set({ promptTemplates: templates });
}

async function renderTemplates() {
  const templates = await loadTemplates();
  tplList.innerHTML = "";

  if (templates.length === 0) {
    tplList.innerHTML = '<div class="tpl-empty">No templates yet. Click ＋ New to add one.</div>';
    return;
  }

  templates.forEach((tpl) => {
    const item = document.createElement("div");
    item.className = "tpl-item";
    item.innerHTML = `
      <span class="tpl-item-name">${escapeHtml(tpl.name)}</span>
      <span class="tpl-item-preview">${escapeHtml(tpl.prompt)}</span>
      <button class="tpl-delete-btn" data-id="${tpl.id}" title="Delete template">✕</button>
    `;

    // Click on row (but not delete btn) → fill input + close
    item.addEventListener("click", (e) => {
      if (e.target.closest(".tpl-delete-btn")) return;
      inputEl.value = tpl.prompt;
      autoResizeInput();
      inputEl.focus();
      closeTemplateDropdown();
    });

    // Delete button
    item.querySelector(".tpl-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const updated = (await loadTemplates()).filter((t) => t.id !== tpl.id);
      await saveTemplates(updated);
      renderTemplates();
    });

    tplList.appendChild(item);
  });
}

function openTemplateDropdown() {
  templateDropdown.classList.add("open");
  templateBtn.classList.add("open");
  renderTemplates();
}

function closeTemplateDropdown() {
  templateDropdown.classList.remove("open");
  templateBtn.classList.remove("open");
  tplAddForm.classList.remove("open");
  tplNameInput.value = "";
  tplPromptInput.value = "";
}

// Toggle dropdown
templateBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (templateDropdown.classList.contains("open")) {
    closeTemplateDropdown();
  } else {
    openTemplateDropdown();
  }
});

// Close when clicking outside
document.addEventListener("click", (e) => {
  if (!templateDropdown.contains(e.target) && e.target !== templateBtn) {
    closeTemplateDropdown();
  }
});

// ＋ New button
tplNewBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  tplAddForm.classList.toggle("open");
  if (tplAddForm.classList.contains("open")) {
    // Pre-fill prompt with current input text if any
    const current = inputEl.value.trim();
    if (current) tplPromptInput.value = current;
    tplNameInput.focus();
  }
});

// Cancel add form
tplCancelBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  tplAddForm.classList.remove("open");
  tplNameInput.value = "";
  tplPromptInput.value = "";
});

// Save new template
tplSaveBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  const name   = tplNameInput.value.trim();
  const prompt = tplPromptInput.value.trim();
  if (!name || !prompt) {
    tplNameInput.style.borderColor = name ? "" : "#f87171";
    tplPromptInput.style.borderColor = prompt ? "" : "#f87171";
    return;
  }
  tplNameInput.style.borderColor = "";
  tplPromptInput.style.borderColor = "";

  const templates = await loadTemplates();
  templates.push({ id: `tpl-${Date.now()}`, name, prompt });
  await saveTemplates(templates);

  tplAddForm.classList.remove("open");
  tplNameInput.value = "";
  tplPromptInput.value = "";
  renderTemplates();
});

// Prevent form clicks from bubbling to the document close-handler
tplAddForm.addEventListener("click", (e) => e.stopPropagation());
templateDropdown.addEventListener("click", (e) => e.stopPropagation());
