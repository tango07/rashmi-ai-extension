// content.js — Content Script (runs on all pages)
// 1. Extracts page text and pushes it to the background as "page context".
// 2. Detects quiz / assessment questions and injects an "Answer with Claude" button.

(function () {
  "use strict";

  let lastUrl = location.href;
  let debounceTimer = null;
  let contentStabilityTimer = null;
  let lastTextLength = 0;
  let voiceRecognition = null;

  // ── Helper: safe chrome.runtime.sendMessage ───────────────────────────────
  // "Extension context invalidated" happens when the extension is reloaded
  // while the page is still open. We catch it silently and stop all timers.
  function safeSend(message) {
    try {
      if (!chrome.runtime?.id) return; // context already gone
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Context invalidated — stop observers and timers silently
      navObserver.disconnect();
      clearInterval(contentStabilityTimer);
      clearTimeout(debounceTimer);
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  waitForContentThenInit();
  initSelectionTooltip();
  initAnimations();
  initRashmiCharacter();

  // Re-run when the SPA navigates to a new path
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(waitForContentThenInit, 800);
    }
  });
  navObserver.observe(document.body, { subtree: true, childList: true });

  // Listen for messages from the side panel
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "MANUAL_SCAN") {
        extractAndStoreContext(true);
        return;
      }

      // ── Voice recognition (runs in page context where Speech API works) ──
      if (message.type === "START_VOICE") {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { sendResponse({ ok: false, error: "not_supported" }); return; }

        if (voiceRecognition) { try { voiceRecognition.stop(); } catch {} voiceRecognition = null; }

        voiceRecognition = new SR();
        voiceRecognition.continuous = false;
        voiceRecognition.interimResults = true;
        voiceRecognition.lang = "en-US";

        voiceRecognition.onresult = (e) => {
          const transcript = Array.from(e.results).map((r) => r[0].transcript).join("");
          safeSend({ type: "VOICE_RESULT", transcript });
        };
        voiceRecognition.onend = () => {
          safeSend({ type: "VOICE_END" });
          voiceRecognition = null;
        };
        voiceRecognition.onerror = (e) => {
          safeSend({ type: "VOICE_END", error: e.error });
          voiceRecognition = null;
        };

        try { voiceRecognition.start(); sendResponse({ ok: true }); }
        catch (err) { sendResponse({ ok: false, error: err.message }); }
        return true; // async response
      }

      if (message.type === "STOP_VOICE") {
        if (voiceRecognition) { try { voiceRecognition.stop(); } catch {} voiceRecognition = null; }
        sendResponse({ ok: true });
        return;
      }
    });
  } catch { /* context already gone on first load edge case */ }

  // ── Wait for page content to stabilise ───────────────────────────────────
  function waitForContentThenInit() {
    let attempts = 0;
    const maxAttempts = 20;

    clearInterval(contentStabilityTimer);
    contentStabilityTimer = setInterval(() => {
      attempts++;
      const currentLength = document.body.innerText.length;

      if (currentLength > 200 && currentLength === lastTextLength) {
        clearInterval(contentStabilityTimer);
        init();
      } else {
        lastTextLength = currentLength;
      }

      if (attempts >= maxAttempts) {
        clearInterval(contentStabilityTimer);
        init();
      }
    }, 500);
  }

  // ── Main init ─────────────────────────────────────────────────────────────
  function init() {
    extractAndStoreContext(false);
    injectContextualButtons();
  }

  // ── Extract page text ─────────────────────────────────────────────────────
  async function extractAndStoreContext(manual = false) {
    const title = document.title || "";

    // ── PDF pages: extract via proxy ─────────────────────────────────────────
    const isPdf = document.contentType === "application/pdf" ||
                  /\.pdf(\?|#|$)/i.test(location.href);

    if (isPdf && /^https?:\/\//i.test(location.href)) {
      if (manual) {
        safeSend({ type: "SCAN_STATUS", payload: { status: "scanning", message: "Extracting PDF text…" } });
      }
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "GET_PDF_TEXT",
          payload: { url: location.href },
        });
        if (resp?.ok && resp.text) {
          const pdfTitle = resp.title || title || "PDF Document";
          const context = {
            title:     pdfTitle,
            url:       location.href,
            text:      resp.text.slice(0, 20000),
            scannedAt: new Date().toISOString(),
            manual,
            isPdf:     true,
            pages:     resp.pages,
          };
          safeSend({ type: "SET_PAGE_CONTEXT", payload: context });
          if (manual) {
            safeSend({
              type: "SCAN_STATUS",
              payload: { status: "ok", chars: resp.text.length, title: pdfTitle, source: "pdf", pages: resp.pages },
            });
          }
          return;
        }
      } catch { /* fall through to DOM text if proxy fails */ }

      if (manual) {
        safeSend({
          type: "SCAN_STATUS",
          payload: { status: "empty", message: "Could not extract PDF text. Make sure the proxy server is running." },
        });
      }
      return;
    }

    let bodyText = getReadableText();

    // On YouTube video pages, enrich context with the full transcript
    const ytVideoId = new URLSearchParams(location.search).get("v");
    if (ytVideoId && location.hostname.includes("youtube.com")) {
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "GET_YOUTUBE_TRANSCRIPT",
          payload: { videoId: ytVideoId },
        });
        if (resp?.ok && resp.transcript) {
          bodyText = `[YouTube Transcript]\n${resp.transcript}\n\n[Page Description]\n${bodyText}`;
          if (manual) {
            safeSend({
              type: "SCAN_STATUS",
              payload: { status: "ok", chars: bodyText.length, title, source: "transcript" },
            });
          }
        }
      } catch { /* transcript fetch failed, fall through to page text */ }
    }

    if (!bodyText || bodyText.length < 50) {
      if (manual) {
        safeSend({
          type: "SCAN_STATUS",
          payload: { status: "empty", message: "Page appears empty or not yet loaded. Try again in a moment." },
        });
      }
      return;
    }

    const context = {
      title,
      url: location.href,
      text: bodyText.slice(0, 20000),
      scannedAt: new Date().toISOString(),
      manual,
    };

    safeSend({ type: "SET_PAGE_CONTEXT", payload: context });

    if (manual && !location.hostname.includes("youtube.com")) {
      safeSend({
        type: "SCAN_STATUS",
        payload: { status: "ok", chars: bodyText.length, title },
      });
    }
  }

  function getReadableText() {
    const clone = document.body.cloneNode(true);

    clone.querySelectorAll(
      "script, style, noscript, header, footer, nav, " +
      "[aria-hidden='true'], .claude-answer-btn, .claude-answer-box, " +
      "svg, canvas, [role='toolbar'], [role='banner'], [role='navigation']"
    ).forEach((el) => el.remove());

    const mainSelectors = [
      "main", "[role='main']", "article",
      "[class*='content']", "[class*='lesson']",
      "[class*='course']", "[class*='module']",
      "[class*='player']", "[class*='viewer']",
    ];

    for (const sel of mainSelectors) {
      const el = clone.querySelector(sel);
      if (el && el.innerText.trim().length > 200) {
        return el.innerText.replace(/\s{3,}/g, "\n\n").trim();
      }
    }

    return clone.innerText.replace(/\s{3,}/g, "\n\n").trim();
  }

  // ── Page-type detection ───────────────────────────────────────────────────
  function detectPageType() {
    const host = location.hostname;
    const params = new URLSearchParams(location.search);

    // YouTube — only inject on the video watch page, nowhere else
    if (host.includes("youtube.com")) {
      return params.get("v") ? "youtube-video" : null;
    }

    // Quiz / form (check before article — more specific)
    const hasQuizInputs = document.querySelector(
      "form input[type='radio'], form input[type='checkbox'], " +
      "[class*='question'] input, [class*='quiz'] input, " +
      "[class*='assessment'] input, [class*='exercise'] input"
    );
    if (hasQuizInputs) return "quiz";

    // Article / blog post
    const hasArticle = document.querySelector(
      "article, [role='article'], [class*='article-body'], " +
      "[class*='post-content'], [class*='entry-content'], [class*='blog-content']"
    );
    if (hasArticle) return "article";

    return null;
  }

  // ── Contextual button injection ───────────────────────────────────────────
  function injectContextualButtons() {
    const pageType = detectPageType();
    if (!pageType) return;

    setTimeout(() => {
      if (pageType === "youtube-video") injectYouTubeButton();
      if (pageType === "article")       injectArticleButton();
      if (pageType === "quiz")          injectQuizButtons();
    }, 1500);
  }

  // YouTube: one button below the video title (with retry for SPA load)
  function injectYouTubeButton() {
    const SELECTORS = [
      "ytd-watch-metadata h1",
      "#above-the-fold h1",
      "h1.ytd-watch-metadata",
      "#title h1",
      "ytd-video-primary-info-renderer h1",
    ];

    function tryInject() {
      for (const sel of SELECTORS) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 0) {
          if (el.dataset.claudeInjected) return true;
          el.dataset.claudeInjected = "true";
          const btn = createContextBtn("🎬 Summarise video", "youtube");
          btn.addEventListener("click", () => {
            triggerSidePanel(
              "Please summarise this YouTube video. Include the main topics covered, " +
              "key takeaways, and any important points or conclusions mentioned."
            );
          });
          el.insertAdjacentElement("afterend", btn);
          return true;
        }
      }
      return false;
    }

    // Try immediately, then retry up to 8 times (YouTube SPA can be slow)
    if (!tryInject()) {
      let attempts = 0;
      const retry = setInterval(() => {
        attempts++;
        if (tryInject() || attempts >= 8) clearInterval(retry);
      }, 800);
    }
  }

  // Article: one button right after the H1
  function injectArticleButton() {
    const h1 = document.querySelector("article h1, [role='article'] h1, h1");
    if (!h1 || h1.dataset.claudeInjected) return;
    h1.dataset.claudeInjected = "true";

    const btn = createContextBtn("📄 Summarise article", "article");
    btn.addEventListener("click", () => {
      triggerSidePanel(
        "Please summarise this article. Cover the main arguments, key evidence, " +
        "and the author's conclusions."
      );
    });
    h1.insertAdjacentElement("afterend", btn);
  }

  // Quiz: one button per question container
  function injectQuizButtons() {
    findQuizContainers().forEach((container) => {
      if (container.dataset.claudeInjected) return;
      container.dataset.claudeInjected = "true";

      const btn = createContextBtn("✨ Answer with Claude", "quiz");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const questionText = container.innerText.slice(0, 1500);
        triggerSidePanel(
          `Help me answer this question:\n\n${questionText}`
        );
      });
      container.appendChild(btn);
    });
  }

  function findQuizContainers() {
    const results = new Set();

    // Only real form elements — no broad ARIA roles
    document.querySelectorAll(
      "form, [class*='question'], [class*='quiz'], " +
      "[class*='assessment'], [class*='task'], [class*='exercise']"
    ).forEach((el) => {
      if (el.querySelector("input[type='radio'], input[type='checkbox'], input[type='text'], textarea")) {
        results.add(el);
      }
    });

    // Numbered questions that contain an input
    document.querySelectorAll("p, div, li, section").forEach((el) => {
      const text = el.innerText || "";
      if (/^\s*\d+[\.\)]\s+.{10,}/.test(text) && el.querySelector("input, textarea, select")) {
        results.add(el);
      }
    });

    return Array.from(results).slice(0, 30);
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  function createContextBtn(label, type) {
    const btn = document.createElement("button");
    btn.className = `claude-context-btn claude-btn-${type}`;
    btn.textContent = label;
    return btn;
  }

  function triggerSidePanel(prompt) {
    // Only show the floating result panel.
    // The side panel opens only if the user clicks "Add to chat".
    showFloatingResult(prompt);
  }

  // ── Floating result overlay (streaming + thinking) ───────────────────────
  async function showFloatingResult(prompt) {
    document.querySelector(".claude-float-panel")?.remove();

    const panel = document.createElement("div");
    panel.className = "claude-float-panel";
    panel.innerHTML = `
      <div class="claude-float-header">
        <span>✨ Rashmi AI</span>
        <button class="claude-float-close" title="Close">✕</button>
      </div>
      <div class="claude-float-body">
        <div class="claude-float-loading">
          <div class="claude-float-spinner"></div>
          <span>Connecting…</span>
        </div>
      </div>
      <div class="claude-float-footer" style="display:none">
        <button class="claude-float-add-btn">💬 Add to chat</button>
      </div>
    `;

    const body   = panel.querySelector(".claude-float-body");
    const footer = panel.querySelector(".claude-float-footer");
    panel.querySelector(".claude-float-close").addEventListener("click", () => panel.remove());
    document.body.appendChild(panel);

    try {
      if (!chrome.runtime?.id) throw new Error("Extension reloaded — please refresh.");

      const pageCtx  = getReadableText().slice(0, 8000);
      const { model } = await chrome.storage.local.get("model");
      const selectedModel = model || "claude-sonnet-4-5";
      // Thinking requires Sonnet or Opus
      const useThinking = selectedModel.includes("sonnet") || selectedModel.includes("opus");

      const port = chrome.runtime.connect({ name: "claude-stream" });

      let thinkingBlockEl = null;
      let thinkingBodyEl  = null;
      let thinkingText    = "";
      let answerEl        = null;
      let answerText      = "";
      let bodyCleared     = false;

      function ensureBodyCleared() {
        if (!bodyCleared) { body.innerHTML = ""; bodyCleared = true; }
      }

      port.onMessage.addListener((msg) => {

        if (msg.type === "THINKING_START") {
          ensureBodyCleared();
          thinkingBlockEl = document.createElement("div");
          thinkingBlockEl.className = "claude-float-thinking";
          thinkingBlockEl.innerHTML = `
            <div class="claude-float-thinking-header">
              <div class="claude-float-spinner cft-spinner"></div>
              <span class="cft-title">🧠 Reasoning…</span>
              <span class="cft-toggle">▼</span>
            </div>
            <div class="claude-float-thinking-body"></div>
          `;
          thinkingBodyEl = thinkingBlockEl.querySelector(".claude-float-thinking-body");
          let collapsed = false;
          thinkingBlockEl.querySelector(".claude-float-thinking-header")
            .addEventListener("click", () => {
              collapsed = !collapsed;
              thinkingBodyEl.style.display = collapsed ? "none" : "";
              thinkingBlockEl.querySelector(".cft-toggle").textContent = collapsed ? "▶" : "▼";
            });
          body.appendChild(thinkingBlockEl);
        }

        if (msg.type === "THINKING_CHUNK" && thinkingBodyEl) {
          thinkingText += msg.text;
          thinkingBodyEl.textContent = thinkingText;
          body.scrollTop = body.scrollHeight;
        }

        if (msg.type === "TEXT_START") {
          ensureBodyCleared();
          // Stop thinking spinner, update header
          if (thinkingBlockEl) {
            const sp = thinkingBlockEl.querySelector(".cft-spinner");
            if (sp) { sp.style.animation = "none"; sp.style.borderTopColor = "#a78bfa"; }
            const title = thinkingBlockEl.querySelector(".cft-title");
            if (title) title.textContent = "🧠 Reasoning";
          }
          answerEl = document.createElement("div");
          answerEl.className = "claude-float-answer streaming";
          body.appendChild(answerEl);
        }

        if (msg.type === "TEXT_CHUNK") {
          if (!answerEl) {
            ensureBodyCleared();
            answerEl = document.createElement("div");
            answerEl.className = "claude-float-answer streaming";
            body.appendChild(answerEl);
          }
          answerText += msg.text;
          answerEl.textContent = answerText;
          body.scrollTop = body.scrollHeight;
        }

        if (msg.type === "STREAM_END") {
          if (answerEl) answerEl.classList.remove("streaming");
          port.disconnect();
          // Show "Add to chat" button now that we have a complete answer
          if (answerText) {
            footer.style.display = "block";
            footer.querySelector(".claude-float-add-btn").addEventListener("click", () => {
              safeSend({
                type: "INJECT_CHAT",
                payload: { userMessage: prompt, assistantMessage: answerText },
              });
              panel.remove();
            });
          }
        }

        if (msg.type === "STREAM_ERROR") {
          ensureBodyCleared();
          body.innerHTML = `<div class="claude-float-error">❌ ${escapeHtml(msg.error)}</div>`;
          port.disconnect();
        }
      });

      port.onDisconnect.addListener(() => {
        if (answerEl) answerEl.classList.remove("streaming");
      });

      port.postMessage({
        type: "START_STREAM",
        payload: {
          messages: [{
            role: "user",
            content: `Page content:\n\n${pageCtx}\n\n---\n\n${prompt}`,
          }],
          systemPrompt:
            "Your name is Rashmi. You are a smart, friendly AI browsing assistant. " +
            "Use the provided page content to answer the user's request clearly and concisely. " +
            "Always refer to yourself as Rashmi.",
          model: selectedModel,
          thinking: useThinking,
        },
      });

    } catch (err) {
      body.innerHTML = `<div class="claude-float-error">❌ ${escapeHtml(err.message)}</div>`;
    }
  }

  // ── Text selection tooltip ────────────────────────────────────────────────
  function initSelectionTooltip() {
    let tooltip = null;

    function removeTooltip() {
      tooltip?.remove();
      tooltip = null;
    }

    document.addEventListener("mouseup", (e) => {
      // Don't show inside our own UI
      if (e.target.closest(".claude-float-panel, .claude-context-btn, .claude-selection-tooltip")) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (!text || text.length < 5) { removeTooltip(); return; }

        removeTooltip();

        const range = selection.getRangeAt(0);
        const rect  = range.getBoundingClientRect();

        tooltip = document.createElement("button");
        tooltip.className = "claude-selection-tooltip";
        tooltip.textContent = "✨ Ask Claude";
        tooltip.style.top  = `${window.scrollY + rect.top - 40}px`;
        tooltip.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;

        tooltip.addEventListener("mousedown", (ev) => {
          ev.preventDefault(); // keep selection alive
          const selectedText = text;
          removeTooltip();
          window.getSelection()?.removeAllRanges();
          showFloatingResult(`About this text:\n\n"${selectedText}"\n\nPlease explain this and answer any questions about it.`);
        });

        document.body.appendChild(tooltip);
      }, 10);
    });

    document.addEventListener("mousedown", (e) => {
      if (!e.target.closest(".claude-selection-tooltip")) removeTooltip();
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Rashmi mascot character ───────────────────────────────────────────────
  function initRashmiCharacter() {
    if (document.getElementById("rashmi-char-wrapper")) return;

    // ── Character CSS ─────────────────────────────────────────────────────
    const s = document.createElement("style");
    s.id = "rashmi-char-styles";
    s.textContent = `
      @keyframes rashmi-char-bob {
        0%, 100% { transform: translateY(0px); }
        50%      { transform: translateY(-9px); }
      }
      @keyframes rashmi-char-enter {
        from { transform: translateY(130px); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }

      #rashmi-char-wrapper {
        position: fixed;
        bottom: 0; right: 110px;
        z-index: 2147483644;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.4s ease;
        user-select: none; -webkit-user-select: none;
        display: flex; flex-direction: column; align-items: center;
      }
      #rashmi-char-wrapper.visible {
        opacity: 1;
        animation: rashmi-char-enter 0.65s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      .rashmi-char-inner {
        display: flex; flex-direction: column; align-items: center;
        animation: rashmi-char-bob 2.6s ease-in-out 0.65s infinite;
        filter: drop-shadow(0 8px 20px rgba(0,0,0,0.3));
        transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1), filter 0.22s ease;
      }
      #rashmi-char-wrapper:hover .rashmi-char-inner {
        animation: none;
        transform: translateY(-14px) scale(1.09);
        filter: drop-shadow(0 16px 30px rgba(99,102,241,0.55));
      }
      .rashmi-char-img { width: 120px; height: 120px; display: block; object-fit: contain; object-position: bottom center; }

      /* Speech bubble */
      .rashmi-char-bubble {
        background: #fff; border: 1.5px solid #c4b5fd;
        border-radius: 14px; padding: 6px 13px;
        font-size: 12px; font-weight: 700; color: #6366f1;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        white-space: nowrap; margin-bottom: 4px;
        opacity: 0; transform: translateY(8px) scale(0.85);
        transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
        pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,0.13);
        position: relative;
      }
      .rashmi-char-bubble::after  { content:''; position:absolute; bottom:-8px; left:50%; transform:translateX(-50%); border:5px solid transparent; border-top-color:#fff; }
      .rashmi-char-bubble::before { content:''; position:absolute; bottom:-10px; left:50%; transform:translateX(-50%); border:6px solid transparent; border-top-color:#c4b5fd; }
      #rashmi-char-wrapper:hover .rashmi-char-bubble { opacity:1; transform:translateY(0) scale(1); }
    `;
    (document.head || document.documentElement).appendChild(s);

    // ── Character DOM ─────────────────────────────────────────────────────
    const wrapper = document.createElement("div");
    wrapper.id = "rashmi-char-wrapper";
    wrapper.title = "Chat with Rashmi AI";
    wrapper.innerHTML = `
      <div class="rashmi-char-inner">
        <div class="rashmi-char-bubble">Hi! I'm Rashmi ✨</div>
        <img class="rashmi-char-img" src="data:image/png;base64,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" alt="Rashmi AI" draggable="false" />
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);
    setTimeout(() => wrapper.classList.add("visible"), 800);

    wrapper.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_PANEL" }).catch(() => {});
    });
  }

  // ── Animations ───────────────────────────────────────────────────────────
  function initAnimations() {
    if (document.getElementById("rashmi-anim-styles")) return;

    // ── CSS keyframes + helper rules ─────────────────────────────────────
    const style = document.createElement("style");
    style.id = "rashmi-anim-styles";
    style.textContent = `
      /* IMDb badge — hover "…" pop */
      @keyframes rashmi-badge-pop {
        0%   { transform: scale(0.55); opacity: 0; }
        65%  { transform: scale(1.1);  opacity: 1; }
        100% { transform: scale(1);    opacity: 1; }
      }
      /* IMDb badge — perm badge first reveal */
      @keyframes rashmi-perm-appear {
        from { opacity: 0; transform: scale(0.8); }
        to   { opacity: 1; transform: scale(1);   }
      }

      /* Contextual buttons */
      .claude-context-btn {
        transition: transform 0.15s ease, box-shadow 0.15s ease !important;
      }
      .claude-context-btn:hover {
        transform: translateY(-2px) scale(1.04) !important;
        box-shadow: 0 6px 20px rgba(139,92,246,0.35) !important;
      }
      .claude-context-btn:active {
        transform: scale(0.97) !important;
        transition-duration: 0.05s !important;
      }

      /* Selection tooltip entrance */
      @keyframes rashmi-tooltip-in {
        0%   { transform: translateX(-50%) scale(0.7);  opacity: 0; }
        70%  { transform: translateX(-50%) scale(1.06); opacity: 1; }
        100% { transform: translateX(-50%) scale(1);    opacity: 1; }
      }
      .claude-selection-tooltip {
        animation: rashmi-tooltip-in 0.2s cubic-bezier(0.34,1.56,0.64,1) both !important;
      }

      /* Ambient sparkle canvas */
      #rashmi-sparkles {
        position: fixed;
        bottom: 14px; right: 14px;
        width: 140px; height: 140px;
        pointer-events: none;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 1.2s ease;
      }
      #rashmi-sparkles.visible { opacity: 1; }
    `;
    (document.head || document.documentElement).appendChild(style);

    // ── Ambient sparkle canvas ────────────────────────────────────────────
    const canvas = document.createElement("canvas");
    canvas.id = "rashmi-sparkles";
    canvas.width = 140;
    canvas.height = 140;
    document.body.appendChild(canvas);
    setTimeout(() => canvas.classList.add("visible"), 300);

    const ctx = canvas.getContext("2d");
    const COLORS = ["#a78bfa", "#8b5cf6", "#c4b5fd", "#f5c518", "#fde68a", "#ffffff"];

    const particles = Array.from({ length: 22 }, () => spawnParticle(true));

    function spawnParticle(randomY) {
      return {
        x:        Math.random() * 140,
        y:        randomY ? Math.random() * 140 : 146,
        r:        Math.random() * 2.2 + 0.8,
        vy:       -(Math.random() * 0.5 + 0.2),
        vx:       (Math.random() - 0.5) * 0.3,
        alpha:    randomY ? Math.random() * 0.9 : 0,
        dAlpha:   Math.random() * 0.018 + 0.006,
        maxAlpha: Math.random() * 0.5 + 0.5,
        fading:   false,
        color:    COLORS[Math.floor(Math.random() * COLORS.length)],
        rot:      Math.random() * Math.PI * 2,
        dRot:     (Math.random() - 0.5) * 0.04,
      };
    }

    (function drawSparkles() {
      ctx.clearRect(0, 0, 140, 140);
      particles.forEach((p, i) => {
        p.x   += p.vx;
        p.y   += p.vy;
        p.rot += p.dRot;
        if (!p.fading) {
          p.alpha = Math.min(p.alpha + p.dAlpha, p.maxAlpha);
          if (p.alpha >= p.maxAlpha) p.fading = true;
        } else {
          p.alpha -= p.dAlpha * 0.8;
          if (p.alpha <= 0 || p.y < -5) { particles[i] = spawnParticle(false); return; }
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = p.color;
        // 4-pointed star
        const s = p.r;
        ctx.beginPath();
        ctx.moveTo(0, -s * 2.4); ctx.lineTo(s * 0.45, -s * 0.45);
        ctx.lineTo(s * 2.4, 0);  ctx.lineTo(s * 0.45, s * 0.45);
        ctx.lineTo(0, s * 2.4);  ctx.lineTo(-s * 0.45, s * 0.45);
        ctx.lineTo(-s * 2.4, 0); ctx.lineTo(-s * 0.45, -s * 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      requestAnimationFrame(drawSparkles);
    })();
  }

  //── Netflix IMDb rating on hover ──────────────────────────────────────────
  if (location.hostname.includes("netflix.com")) {
    initNetflixImdbHover();
  }

  function initNetflixImdbHover() {
    const cache   = {};         // title → rating string | null (null = not in OMDB)
    const permMap = new Map();  // img el → badge el  (permanent, always-visible badges)

    let hoverBadge    = null;   // the "…" loading badge shown while fetching
    let hoverImg      = null;
    let hoverTitle    = null;
    let pendingTitle  = null;   // debounce accumulator
    let pendingImg    = null;
    let debounceTimer = null;
    let fetchTimer    = null;
    let removeTimer   = null;
    let permRaf       = null;

    // ── thumbnail filter ─────────────────────────────────────────────────────
    function isNetflixThumb(img) {
      if (!img || img.tagName !== "IMG") return false;
      const alt = img.alt?.trim();
      if (!alt || alt.length < 2 || alt.length > 120) return false;
      if (alt.includes("|")) return false;
      if (/^[A-Z][A-Z_]{2,}$/.test(alt)) return false;
      if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(alt)) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 80 && r.height >= 45;
    }

    function area(img) {
      const r = img.getBoundingClientRect();
      return r.width * r.height;
    }

    // ── Badge factory ────────────────────────────────────────────────────────
    const BADGE_BASE = [
      "position:fixed",
      "background:rgba(0,0,0,0.88)",
      "color:#fff",
      "font-size:13px",
      "font-weight:700",
      "padding:4px 10px 4px 7px",
      "border-radius:6px",
      "z-index:2147483647",
      "pointer-events:none",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "line-height:1.5",
      "box-shadow:0 2px 8px rgba(0,0,0,0.7)",
    ].join(";");

    function makeBadge(text, rect) {
      const b = document.createElement("div");
      b.className = "rashmi-imdb-badge";
      b.innerHTML = `⭐ <b style="color:#f5c518">${text}</b>`;
      b.style.cssText = `${BADGE_BASE};top:${Math.round(rect.top + 6)}px;left:${Math.round(rect.left + 6)}px`;
      return b;
    }

    // ── Permanent badge system ────────────────────────────────────────────────
    // Badges added here are never removed — they stay on the card forever.
    // A single RAF loop keeps all positions in sync with scroll & layout changes.
    function addPermBadge(img, ratingText) {
      if (permMap.has(img)) {
        permMap.get(img).querySelector("b").textContent = ratingText;
        return;
      }
      const r = img.getBoundingClientRect();
      if (r.width < 10) return; // not visible yet; MutationObserver will retry
      const badge = makeBadge(ratingText, r);
      badge.style.visibility = "hidden"; // syncPerm will make it visible
      document.body.appendChild(badge);
      permMap.set(img, badge);
      startPermRaf();
    }

    function syncPerm() {
      permMap.forEach((badge, img) => {
        if (!document.contains(img)) { badge.remove(); permMap.delete(img); return; }
        const r = img.getBoundingClientRect();
        const vis = r.width >= 10 && r.top < window.innerHeight + 20 && r.bottom > -20;
        if (vis) {
          badge.style.top  = `${Math.round(r.top  + 6)}px`;
          badge.style.left = `${Math.round(r.left + 6)}px`;
          if (!badge.dataset.appeared) {
            // First time this badge scrolls into view — play appear animation
            badge.dataset.appeared = "1";
            badge.style.animation  = "rashmi-perm-appear 0.2s ease-out both";
          }
        }
        badge.style.visibility = vis ? "visible" : "hidden";
      });
    }

    function startPermRaf() {
      if (permRaf) return;
      (function loop() { syncPerm(); permRaf = requestAnimationFrame(loop); })();
    }

    // Called after a rating is fetched: upgrades hover badge → perm and
    // stamps all other matching imgs already in the DOM.
    function onRatingFetched(title, rating) {
      if (!rating) {
        // Title not in OMDB — dismiss loading badge; cache prevents re-fetch
        removeHoverBadge();
        return;
      }
      const ratingText = `${rating}/10`;

      // Upgrade the hover ("…") badge to permanent
      if (hoverTitle === title && hoverBadge && hoverImg) {
        hoverBadge.querySelector("b").textContent = ratingText;
        hoverBadge.dataset.appeared = "1"; // already visible — no re-animation needed
        permMap.set(hoverImg, hoverBadge);
        startPermRaf();
        hoverBadge = hoverImg = hoverTitle = null; // hand off to perm
      } else {
        removeHoverBadge();
      }

      // Stamp every other matching img already in the DOM
      document.querySelectorAll("img").forEach(img => {
        if (!permMap.has(img) && isNetflixThumb(img) && img.alt?.trim() === title) {
          addPermBadge(img, ratingText);
        }
      });
    }

    // ── MutationObserver: stamp badges on new cards as Netflix renders them ──
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const imgs = node.tagName === "IMG"
            ? [node]
            : [...(node.querySelectorAll?.("img") ?? [])];
          for (const img of imgs) {
            if (!isNetflixThumb(img)) continue;
            const title = img.alt?.trim();
            if (!title || !(title in cache) || !cache[title]) continue;
            addPermBadge(img, `${cache[title]}/10`);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });

    // ── OMDB fetch via background ─────────────────────────────────────────────
    async function fetchRating(title) {
      if (title in cache) return cache[title];
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "GET_IMDB_RATING", payload: { title },
        });
        const rating = resp?.ok && resp.imdbRating ? resp.imdbRating : null;
        cache[title] = rating;
        onRatingFetched(title, rating);
        return rating;
      } catch {
        cache[title] = null;
        removeHoverBadge();
        return null;
      }
    }

    // ── Hover system — only needed to trigger the first-time fetch ────────────
    // Once a title is cached, perm badges handle all display.
    function removeHoverBadge() {
      clearTimeout(fetchTimer);
      hoverBadge?.remove();
      hoverBadge = hoverImg = hoverTitle = null;
    }

    document.addEventListener("mouseover", (e) => {
      const img = e.target.closest("img") ||
                  (e.target !== document && e.target.querySelector?.("img"));
      if (!img || !isNetflixThumb(img)) return;

      const title = img.alt.trim();
      clearTimeout(removeTimer);

      // Already cached (perm badge handles it) — nothing to do
      if (title in cache) return;

      // Same title already in hover or pending — keep smallest img
      if (title === hoverTitle)   { if (area(img) < area(hoverImg))   hoverImg   = img; return; }
      if (title === pendingTitle) { if (area(img) < area(pendingImg)) pendingImg = img; return; }

      // New uncached title — 30 ms debounce collects all overlapping events
      clearTimeout(debounceTimer);
      pendingTitle = title;
      pendingImg   = img;

      debounceTimer = setTimeout(() => {
        const t = pendingTitle, i = pendingImg;
        pendingTitle = pendingImg = null;
        if (!t || (t in cache)) return;

        removeHoverBadge();
        const rect = i.getBoundingClientRect();
        if (rect.width < 10) return;

        hoverBadge = makeBadge("…", rect);
        hoverBadge.style.animation = "rashmi-badge-pop 0.22s cubic-bezier(0.34,1.56,0.64,1) both";
        document.body.appendChild(hoverBadge);
        hoverImg   = i;
        hoverTitle = t;

        fetchTimer = setTimeout(() => fetchRating(t), 0);
      }, 30);
    }, true);

    // Mouseout only removes the loading ("…") badge.
    // Permanent badges are never removed by mouse events.
    document.addEventListener("mouseout", (e) => {
      if (!hoverBadge && !pendingTitle) return;
      clearTimeout(removeTimer);
      removeTimer = setTimeout(() => {
        clearTimeout(debounceTimer);
        pendingTitle = pendingImg = null;
        removeHoverBadge();
      }, 200);
    }, true);
  }

})();
