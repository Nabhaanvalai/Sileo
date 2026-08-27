# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This repo contains Sileo, a free dictation app (open-source alternative to Wispr Flow / Superwhisper / Monologue), built for Windows using Electron.

- **`electron-app/`** — The Windows app built with Electron (Node.js + HTML/CSS).
- **`website/`** — static marketing site (`index.html`, assets, `llms.txt`).

## Windows App (`electron-app/`)

Standard Electron app; no build step for development.

```bash
cd electron-app
npm install
npm start        # or: npm run dev  (both run `electron .`)
```

Process structure:
- **`main.js`** — main process: tray, global hotkey (`globalShortcut`, default `F9`), settings persistence (`settings.json` in userData), configurable OpenAI-compatible transcription/LLM calls, and text injection (writes to clipboard then sends `Ctrl+V` via PowerShell `SendKeys`).
- **`services/ApiClient.js`** — shared HTTP/HTTPS client for provider requests, URL validation, bounded responses, and provider-key policy.
- **`overlay.html` / `overlay-renderer.js` / `overlay-preload.js`** — the floating, non-focusable recording pill. The renderer does the actual `MediaRecorder` audio capture and sends bytes back to main via IPC (`audio-ready`).
- **`index.html` / `renderer.js` / `preload.js`** — the dashboard/settings window (history, settings form).
- IPC flows through `contextBridge` in the preload scripts (`contextIsolation: true`, `nodeIntegration: false`).

The recording loop: hotkey/tray → `triggerRecording()` in main → overlay records → on stop, audio IPC'd to main → `transcribeAudio()` → optional `postProcess()` → inject or copy.

`electron-app/main.js` reads an optional initial Groq key from `GROQ_API_KEY` and otherwise defaults to an empty value. The previously committed key must still be treated as compromised and rotated outside the repository.
