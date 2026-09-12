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

## 📸 Screenshots

> _Add your screenshots here_

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

Rashmi AI works with a free Anthropic API key. Your key is stored **only on your device** — it's never sent anywhere except directly to Anthropic.

1. **Get a free API key**
   - Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   - Sign up (free) and create a new API key
   - New accounts receive free credits

2. **Add it to the extension**
   - Click the 🍓 icon in your toolbar to open the sidebar
   - Click the **⚙️** button in the top-right of the sidebar
   - Paste your key into the **Anthropic API Key** field
   - (Optional) Click **Test** to verify it works
   - Click **Save Settings**

3. **Done!** The ⚙️ button will stop being red once your key is saved.

---

## 🧑‍💻 Usage Guide

### Chatting about a page

1. Navigate to any webpage
2. Click the 🍓 icon to open the sidebar
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
| **Proxy URL** | Advanced: point to a local proxy server instead of calling Anthropic directly |

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

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

Built with [Claude](https://anthropic.com) by Anthropic.
