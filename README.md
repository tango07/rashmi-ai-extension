# 🍓 Rashmi AI — Chrome Extension

> An AI browsing companion powered by Claude. Chat about any webpage, summarize content, ask questions, translate, and more — right from your browser sidebar.

---

## ✨ Features

- **💬 Chat sidebar** — Ask anything about the page you're reading
- **⟳ Page scan** — Extracts and understands the full page content
- **🧠 Extended thinking** — Deep reasoning mode for complex questions
- **📝 Summarize** — One-click summaries of articles, docs, and papers
- **🎬 YouTube transcripts** — Ask questions about any YouTube video
- **📄 PDF support** — Reads and chats about PDF files
- **📸 Screenshot + Ask** — Capture the visible page and ask about it
- **🖱️ Text selection tooltip** — Select any text and ask Claude instantly
- **🎤 Voice input** — Speak your questions
- **🌙 Dark mode** — Easy on the eyes
- **🕓 Chat history** — All your past conversations saved locally
- **📋 Prompt templates** — Save and reuse your favourite prompts
- **🍿 Netflix IMDb ratings** — Hover over Netflix titles to see ratings

---

## 🚀 Installation (from source)

### Prerequisites
- Google Chrome (or any Chromium-based browser)
- A free [Anthropic API key](https://console.anthropic.com/settings/keys)

### Steps

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/rashmi-ai-extension.git
   cd rashmi-ai-extension
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions`
   - Toggle **Developer mode** on (top-right corner)

3. **Load the extension**
   - Click **Load unpacked**
   - Select the `rashmi-ai-extension` folder

4. **Pin it to your toolbar**
   - Click the puzzle icon 🧩 in the Chrome toolbar
   - Find **Rashmi AI** and click the pin icon 📌

---

## 🔑 Setup — Adding Your API Key

Click the **Rashmi AI icon** in your toolbar → **⚙️** button → paste your key → **Save Settings**.

There are two ways to connect, depending on your situation:

---

### Option A — Personal Anthropic account (simplest)

Best for personal use or if you created your own Anthropic account.

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys), sign up free, and create an API key
2. Click the **Rashmi AI icon** in your toolbar to open the sidebar → click **⚙️** → paste your key → **Save Settings**
3. Leave the **Proxy URL** field blank

That's it — the extension calls Anthropic directly.

---

### Option B — Work / organisation account

Some organisations block direct browser-to-Anthropic calls. If you see this error:

> ❌ *CORS requests are not allowed for this Organization because of its settings*

You need to run the companion proxy server locally. It takes 2 minutes:

1. **Clone and start the proxy**
   ```bash
   git clone https://github.com/YOUR_USERNAME/rashmi-ai-proxy.git
   cd rashmi-ai-proxy
   cp .env.example .env
   # Open .env and paste your Anthropic key as ANTHROPIC_API_KEY=sk-ant-...
   npm install
   npm start
   ```
   The proxy runs at `http://localhost:3001`.

2. **Point the extension to the proxy**
   - Click the **Rashmi AI icon** in your toolbar → click **⚙️**
   - Expand **Advanced (optional proxy)**
   - Set Proxy URL to `http://localhost:3001`
   - Click **Save Settings**

The proxy makes server-side API calls on your behalf, bypassing the CORS restriction.

> ⚠️ The proxy must be running whenever you use the extension. Keep the terminal open.

---

## 🧑‍💻 Usage Guide

### Chatting about a page

1. Navigate to any webpage
2. Click the **Rashmi AI icon** in your toolbar to open the sidebar
3. Click **⟳ Scan** to read the page
4. Ask anything in the chat box — e.g. _"Summarise this article"_, _"What are the key takeaways?"_

### YouTube videos

1. Open any YouTube video
2. Click the **"Ask Rashmi about this video"** button that appears below the title
   — or open the sidebar and click Scan
3. Ask questions about the video content

### Text selection

1. Select any text on a page
2. A **"Ask Rashmi ✨"** tooltip appears above the selection
3. Click it to open the sidebar with your selection pre-loaded

### Screenshot

1. Click the 📸 button in the sidebar input area
2. A screenshot of the current viewport is captured and attached
3. Ask any visual question about it

### Extended thinking

1. Click the **🧠 Think** button before sending a message
2. Claude will reason step-by-step before answering (best for hard problems)
3. Works with Sonnet and Opus models only

### Prompt templates

1. Click the **📋** button in the input area
2. Select a saved template or create a new one with **+ New template**
3. Templates are saved locally across sessions

---

## ⚙️ Settings Reference

| Setting | Description |
|---|---|
| **Anthropic API Key** | Your `sk-ant-...` key from console.anthropic.com |
| **Model** | `claude-haiku-4-5` (fast), `claude-sonnet-4-5` (recommended), `claude-opus-4-5` (most capable) |
| **Proxy URL** | Set to `http://localhost:3001` if your org blocks direct browser API calls (see Option B above). Leave blank for personal accounts. |

---

## 🔒 Privacy

- Your API key is stored in `chrome.storage.local` — it never leaves your device except in direct calls to Anthropic's API
- Page content is only sent to Anthropic when you explicitly scan a page and send a message
- Chat history is stored locally in `chrome.storage.local`
- No analytics, no tracking, no third-party servers

---

## 🏗️ Project Structure

```
rashmi-ai-extension/
├── manifest.json        # Extension config (Manifest V3)
├── background.js        # Service worker — handles API calls & routing
├── content.js           # Injected into pages — character, buttons, tooltip
├── content.css          # Styles for injected elements
├── sidepanel.html       # Main chat UI
├── sidepanel.js         # Chat logic, streaming, history, templates
├── popup.html           # Settings popup
├── popup.js             # Settings logic
├── welcome.html         # First-install welcome page
├── rashmi-char.png      # The Rashmi character image
└── icons/               # Extension icons (16, 48, 128px)
```

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---
