// background.js — Service Worker
// Supports two modes:
//   1. Direct: user stores their Anthropic key in popup → calls api.anthropic.com directly
//   2. Proxy:  advanced users run rashmi-ai-proxy locally (or set a custom proxy URL)

const ANTHROPIC_URL    = "https://api.anthropic.com/v1/messages";
const DEFAULT_PROXY    = "http://localhost:3001";
const DEFAULT_MODEL    = "claude-sonnet-4-5";

// Resolve base URLs from storage (direct key takes priority over proxy)
async function getConfig() {
  const { anthropicApiKey, proxyUrl, model } =
    await chrome.storage.local.get(["anthropicApiKey", "proxyUrl", "model"]);
  const base = proxyUrl || DEFAULT_PROXY;
  return {
    apiKey:       anthropicApiKey || null,
    proxyBase:    base,
    proxyUrl:     `${base}/api/claude`,
    streamUrl:    `${base}/api/claude/stream`,
    transcriptUrl:`${base}/api/youtube-transcript`,
    pdfUrl:       `${base}/api/pdf-text`,
    model:        model || DEFAULT_MODEL,
    // Use proxy if user explicitly set a proxy URL, otherwise call Anthropic directly
    useDirect:    !!(anthropicApiKey && anthropicApiKey.startsWith("sk-ant-") && !proxyUrl),
  };
}

// ── Side panel: open when the toolbar icon is clicked ────────────────────────
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ── Badge: show red "!" when no API key is configured ────────────────────────
async function updateBadge() {
  const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
  if (!anthropicApiKey || !anthropicApiKey.startsWith("sk-ant-")) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });
    chrome.action.setTitle({ title: "Rashmi AI — Setup required: click to add your API key" });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Rashmi AI" });
  }
}

// Run on install, startup, and whenever storage changes
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  updateBadge();
  // On first install, open the popup so the user sees the settings immediately
  if (reason === "install") {
    // Open side panel as welcome — popup auto-opens via action click
    chrome.tabs.create({ url: "welcome.html" }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes) => {
  if ("anthropicApiKey" in changes) updateBadge();
});

updateBadge();

// ── Regular (non-streaming) message router ────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ASK_CLAUDE") {
    handleClaudeRequest(message.payload)
      .then((reply) => sendResponse({ ok: true, reply }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "CAPTURE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }

  if (message.type === "GET_IMDB_RATING") {
    const { title } = message.payload;
    getConfig().then(cfg =>
      fetch(`${cfg.proxyBase}/api/imdb-rating?title=${encodeURIComponent(title)}`)
        .then((r) => r.json())
        .then((data) => sendResponse({ ok: true, ...data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }))
    );
    return true;
  }

  if (message.type === "GET_YOUTUBE_TRANSCRIPT") {
    const { videoId } = message.payload;
    getConfig().then(cfg =>
      fetch(`${cfg.transcriptUrl}?videoId=${encodeURIComponent(videoId)}`)
        .then((r) => r.json())
        .then((data) => sendResponse({ ok: true, ...data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }))
    );
    return true;
  }

  if (message.type === "OPEN_PANEL") {
    chrome.sidePanel.open({ tabId: _sender.tab.id }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "GET_PDF_TEXT") {
    const { url } = message.payload;
    getConfig().then(cfg =>
      fetch(`${cfg.pdfUrl}?url=${encodeURIComponent(url)}`)
        .then((r) => r.json())
        .then((data) => sendResponse({ ok: true, ...data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }))
    );
    return true;
  }

  if (message.type === "GET_PAGE_CONTEXT") {
    chrome.storage.session
      .get("pageContext")
      .then((data) => sendResponse({ ok: true, context: data.pageContext || null }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "SET_PAGE_CONTEXT") {
    chrome.storage.session
      .set({ pageContext: message.payload })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "SCAN_STATUS") {
    // Forward scan status to the side panel
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.type === "INJECT_CHAT") {
    const { userMessage, assistantMessage } = message.payload;
    // Open the panel first (synchronous, needs user gesture context)
    chrome.sidePanel.open({ tabId: _sender.tab.id }).catch(() => {});
    // Forward to side panel — works if already open; session storage is the fallback
    chrome.storage.session.set({ pendingChatInject: { userMessage, assistantMessage } })
      .then(() => {
        chrome.runtime.sendMessage({ type: "INJECT_CHAT", userMessage, assistantMessage }).catch(() => {});
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "OPEN_AND_PROMPT") {
    const { prompt } = message.payload;
    // Open the panel FIRST — must be synchronous within the user-gesture handler.
    // Any await/then before this call loses the gesture context and Chrome ignores it.
    chrome.sidePanel.open({ tabId: _sender.tab.id }).catch(() => {});
    // Now do the async work: store prompt + notify panel if already open
    chrome.storage.session.set({ pendingPrompt: prompt }).then(() => {
      chrome.runtime.sendMessage({ type: "INJECT_PROMPT", prompt }).catch(() => {});
      sendResponse({ ok: true });
    }).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── Streaming via long-lived port ─────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "claude-stream") return;

  port.onMessage.addListener(async (message) => {
    if (message.type !== "START_STREAM") return;

    const { messages, systemPrompt, model, thinking } = message.payload;
    const cfg = await getConfig();
    const effectiveModel = model || cfg.model;

    console.log("[Rashmi] Config →", {
      useDirect: cfg.useDirect,
      hasKey: !!cfg.apiKey,
      keyPrefix: cfg.apiKey ? cfg.apiKey.slice(0, 14) + "…" : "none",
      model: effectiveModel,
      streamUrl: cfg.useDirect ? ANTHROPIC_URL : cfg.streamUrl,
    });

    let response;
    try {
      if (cfg.useDirect) {
        // ── Direct Anthropic streaming ──────────────────────────────────────
        const body = {
          model: effectiveModel,
          max_tokens: thinking ? 16000 : 2048,
          stream: true,
          system: systemPrompt || "You are a helpful assistant.",
          messages,
        };
        if (thinking) body.thinking = { type: "enabled", budget_tokens: 10000 };

        response = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify(body),
        });
      } else {
        // ── Proxy streaming ─────────────────────────────────────────────────
        response = await fetch(cfg.streamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            systemPrompt,
            model: effectiveModel,
            thinking: thinking || false,
          }),
        });
      }
    } catch {
      port.postMessage({
        type: "STREAM_ERROR",
        error: cfg.useDirect
          ? "Cannot reach Anthropic. Check your internet connection."
          : "Cannot reach proxy. Make sure it's running: npm start in rashmi-ai-proxy/",
      });
      return;
    }

    if (!response.ok) {
      // Read actual error body for better diagnosis
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || "";
      console.error(`[Rashmi] ${cfg.useDirect ? "Anthropic" : "Proxy"} error ${response.status}:`, errBody);
      port.postMessage({
        type: "STREAM_ERROR",
        error: cfg.useDirect
          ? `Anthropic error ${response.status}${errMsg ? ": " + errMsg : ""}`
          : `Proxy error ${response.status}${errMsg ? ": " + errMsg : ""}`,
      });
      return;
    }

    // Read the SSE stream and forward parsed events to the side panel
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          port.postMessage({ type: "STREAM_END" });
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines  = buffer.split("\n");
        buffer = lines.pop(); // keep any incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          // Inline error from proxy
          if (event.error) {
            port.postMessage({ type: "STREAM_ERROR", error: event.error });
            return;
          }

          // Thinking block started
          if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
            port.postMessage({ type: "THINKING_START" });
          }

          // Text block started
          if (event.type === "content_block_start" && event.content_block?.type === "text") {
            port.postMessage({ type: "TEXT_START" });
          }

          // Thinking chunk
          if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
            port.postMessage({ type: "THINKING_CHUNK", text: event.delta.thinking });
          }

          // Text chunk
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            port.postMessage({ type: "TEXT_CHUNK", text: event.delta.text });
          }

          // Token usage — input tokens arrive in message_start
          if (event.type === "message_start" && event.message?.usage) {
            port.postMessage({
              type: "TOKEN_USAGE",
              inputTokens: event.message.usage.input_tokens || 0,
              outputTokens: 0,
            });
          }

          // Token usage — output tokens arrive in message_delta
          if (event.type === "message_delta" && event.usage) {
            port.postMessage({
              type: "TOKEN_USAGE",
              inputTokens: 0,
              outputTokens: event.usage.output_tokens || 0,
            });
          }

          // Stream complete
          if (event.type === "message_stop") {
            port.postMessage({ type: "STREAM_END" });
            return;
          }
        }
      }
    } catch (err) {
      port.postMessage({ type: "STREAM_ERROR", error: `Stream read error: ${err.message}` });
    }
  });
});

// ── Regular (non-streaming) Claude call ───────────────────────────────────────
async function handleClaudeRequest({ messages, systemPrompt }) {
  const cfg = await getConfig();

  let response;
  try {
    if (cfg.useDirect) {
      // ── Direct Anthropic call ─────────────────────────────────────────────
      response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1024,
          system: systemPrompt || "You are a helpful assistant.",
          messages,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || `API error ${response.status}`);
      return data.content?.[0]?.text ?? "";
    } else {
      // ── Proxy call ────────────────────────────────────────────────────────
      response = await fetch(cfg.proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          systemPrompt: systemPrompt || "You are a helpful assistant.",
          model: cfg.model,
        }),
      });
    }
  } catch (err) {
    if (cfg.useDirect) throw new Error("Cannot reach Anthropic. Check your internet connection.");
    throw new Error("Cannot reach proxy server. Run: cd rashmi-ai-proxy && npm start");
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("Proxy returned unexpected response. Make sure it is running."); }

  if (!response.ok) throw new Error(data?.error || `Proxy error ${response.status}`);
  return data.reply ?? "";
}
