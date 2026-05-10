# FitLock

A Chrome extension that blocks distracting websites until you complete your daily running goal on Strava. Uses AI-powered smart filtering to analyze content in real time — keeping you focused without blanket-banning entire sites.

## Features

- **Strava-Linked Blocking** — Sites stay locked until you hit your daily running distance goal
- **YouTube Smart Lock** — AI analyzes videos in real time, blocking distracting content while allowing educational/productive videos through
- **Local AI Inference** — Runs content analysis on-device via Gemini Nano or Ollama for privacy
- **Cloud Sync** — Syncs your blocked sites and settings across devices via Supabase
- **Daily Reset** — Blocking resets each day so you stay motivated

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Google Chrome](https://www.google.com/chrome/) (v120 or later)
- A [Strava](https://www.strava.com/) account

### Installation

1. **Clone the repo**

   ```bash
   git clone https://github.com/<your-username>/FitLock.git
   cd FitLock/chrome-extension
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build the extension**

   ```bash
   npm run build
   ```

   This creates a `dist/` folder with the production-ready extension.

4. **Load into Chrome**

   1. Open Chrome and navigate to `chrome://extensions`
   2. Enable **Developer mode** (toggle in the top-right corner)
   3. Click **Load unpacked**
   4. Select the `chrome-extension/dist` folder
   5. The FitLock icon should appear in your toolbar

5. **Connect Strava**

   Click the FitLock extension icon and follow the onboarding flow to link your Strava account.

---

## AI Setup (Optional but Recommended)

FitLock uses local AI to power its YouTube Smart Lock feature. You have two options:

### Option A: Gemini Nano (Built into Chrome)

1. Make sure you're on Chrome 120+ with the Gemini Nano flag enabled
2. Go to `chrome://flags/#optimization-guide-on-device-model` → set to **Enabled BypassPerfRequirement**
3. Go to `chrome://flags/#prompt-api-for-gemini-nano` → set to **Enabled**
4. Restart Chrome
5. FitLock will automatically detect and use Gemini Nano

### Option B: Ollama (Local AI Server)

1. Install [Ollama](https://ollama.com/)
2. Pull a small model:
   ```bash
   ollama pull llama3.2:1b
   ```
3. Start Ollama (it runs on `localhost:11434` by default)
4. FitLock will detect it automatically, or you can configure it via the extension's Local AI Setup page

> **Note:** Without AI setup, site-level blocking still works — you just won't get YouTube Smart Lock filtering.

---

## Development

To develop with live rebuilds:

```bash
cd chrome-extension
npm run watch
```

This watches for file changes and rebuilds automatically. After each rebuild, go to `chrome://extensions` and click the refresh icon on the FitLock card to reload the extension.

### Project Structure

```
chrome-extension/
├── public/              # Static assets (manifest, icons, blocked page)
│   ├── manifest.json
│   ├── icons/
│   ├── blocked.html/css/js
│   └── rules.json
├── src/
│   ├── background/      # Service worker modules
│   │   ├── background.js    # Main entry point
│   │   ├── ai.js            # AI inference logic
│   │   ├── strava.js        # Strava API integration
│   │   ├── sync.js          # Cloud sync
│   │   └── ...
│   ├── content/         # Content scripts (YouTube Smart Lock)
│   └── ui/              # Svelte UI (popup, onboarding, setup pages)
├── dist/                # Built extension (load this in Chrome)
├── vite.config.js
└── package.json
```

---

## Tech Stack

- **Extension**: Chrome Manifest V3, vanilla JS service worker
- **UI**: Svelte 5
- **Build**: Vite 7
- **Backend**: Supabase (auth, database, edge functions)
- **AI**: Gemini Nano / Ollama (local inference)

---

## License

ISC