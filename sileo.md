# 🎙️ Sileo — Interview Prep Guide

> **Sileo** is a free, open-source AI dictation app for Windows.
> It is a self-funded, no-subscription alternative to Wispr Flow, Superwhisper, and Monologue.

---

## 🗺️ Big Picture — What Is Sileo?

| Property | Detail |
|---|---|
| **Type** | Desktop application (Windows 10/11) |
| **Framework** | Electron (Node.js + Chromium) |
| **Language** | JavaScript (Node.js in main process, vanilla JS in renderer) |
| **AI backend** | Groq API — Whisper for transcription, LLaMA 3.3 for cleanup |
| **License** | MIT |
| **Distribution** | NSIS installer + portable `.exe` via GitHub Releases CI |

**One-sentence summary:** Press a hotkey → Sileo captures your voice, transcribes it with Whisper-large-v3, cleans the text with an LLM, and injects it into whatever app you're using — like magic.

---

## 🏗️ Architecture Overview

```
Electron App
├── main.js               ← Main process (Node.js) — orchestrates everything
├── preload.js            ← Context bridge for main window (IPC)
├── renderer.js           ← Dashboard UI logic (main window)
├── index.html            ← Dashboard + Settings UI
├── style.css             ← All styles
│
├── overlay.html          ← The floating pill widget
├── overlay-preload.js    ← Context bridge for overlay window (IPC)
├── overlay-renderer.js   ← Mic capture, waveform, auto-stop logic
│
└── services/
    ├── ContextService.js        ← Reads active window + clipboard + screenshot
    ├── CredentialService.js     ← Encrypts API key via Electron safeStorage (DPAPI)
    ├── HistoryService.js        ← JSONL-based transcript history
    ├── PostProcessingService.js ← Builds LLM prompts + calls Groq LLM
    ├── PushToTalkService.js     ← True hold-to-talk via uiohook-napi
    ├── UpdateService.js         ← Checks GitHub releases for new versions
    ├── VisionService.js         ← Sends screenshot to LLaMA-4 Vision for context
    ├── VocabularyService.js     ← Custom vocabulary term matching
    ├── VoiceMacroService.js     ← "trigger => snippet" voice expansion
    └── ZipService.js            ← Bundles test-case exports (audio + screenshot + logs)
```

---

## 🔁 The Core Audio Pipeline (Step by Step)

This is the most important thing to know — what happens when you press `F9`:

```
1. User presses F9
       ↓
2. main.js: triggerRecording() → startRecordingExplicit()
       ↓
3. Overlay window shown; IPC "start-recording" sent to overlay-renderer.js
       ↓
4. overlay-renderer.js: getUserMedia() → MediaRecorder captures mic audio (WebM/Opus)
       ↓  (silence auto-stop at 1.8s; max 119s timer)
5. User presses F9 again (or silence detected)
       ↓
6. MediaRecorder.stop() → audio Blob → ArrayBuffer → base64 string
       ↓
7. IPC "audio-base64-ready" fires → main.js receives base64
       ↓
8. Parallel Promise.all():
      a) transcribeAudioBuffer()  → POST audio to Groq Whisper API
      b) ContextService.getActiveWindowInfo()  → PowerShell → user32.dll
      c) ContextService.getSelectedText()      → PowerShell simulates Ctrl+C
      d) ContextService.getScreenScreenshot()  → desktopCapturer
       ↓
9. VisionService.analyzeVisualContext() → LLaMA-4 Vision reads screenshot
       ↓
10. PostProcessingService.isHallucination(text)  → drops silence noise
        ↓
11. VoiceMacroService.matchMacro(text)  → expands spoken triggers to snippets
        ↓
12. PostProcessingService.processTranscript()  → LLaMA 3.3 cleans/edits text
        ↓
13. HistoryService.addEntry()  → appends to history.jsonl
        ↓
14. injectTextIntoActiveWindow()
      → clipboard.writeText(text)
      → PowerShell SendKeys Ctrl+V into the focused app
        ↓
15. Overlay shows "Done ✓" then hides after 1.5s
```

---

## 🧩 Key Components Explained

### `main.js` — The Brain
- **Single instance lock** prevents duplicate Sileo processes.
- **`DEFAULTS` object** defines all settings with sane values (`F9`, `whisper-large-v3`, `llama-3.3-70b-versatile`, etc.).
- **`loadSettings()`** merges saved `settings.json` with defaults (so new settings get their default on upgrade).
- **`registerHotkey()`** registers both primary and optional second toggle hotkey via Electron's `globalShortcut`.
- **`applyPushToTalk()`** delegates to `PushToTalkService` for true hold-to-talk.
- **IPC handlers** (`ipcMain.handle`) expose all functionality to the renderer securely.
- **App lifecycle**: stays alive in the system tray even when the window is closed (`window-all-closed` does nothing; `app.isQuitting` flag prevents real quit).

---

### `overlay-renderer.js` — The Floating Pill
- Runs in a **frameless, transparent, always-on-top** `BrowserWindow` (92×38px).
- Uses the **Web Audio API** (`AudioContext` + `AnalyserNode`) to:
  - Drive a 5-bar real-time waveform animation (real FFT frequency data, not synthetic).
  - Detect **silence auto-stop** — if mic volume stays below threshold `5/255` for 1.8s, recording stops automatically.
  - Detect **mic-off** — if `heardAnySound` is still false when recording stops and there are no chunks, it reports an error.
- `MediaRecorder` captures audio as `audio/webm;codecs=opus` (prefers Opus).
- In **live transcription mode**, a 2.5-second flush interval ships interim clips to main for progressive Whisper calls.
- On stop: Blob → ArrayBuffer → base64 → sent via IPC.

---

### `ContextService.js` — Reading the User's Context
Three things are gathered in **parallel** before LLM cleanup:

| Method | How it works |
|---|---|
| `getActiveWindowInfo()` | Inline C# in PowerShell calls `user32.dll GetForegroundWindow()` → gets window title + process name |
| `getSelectedText()` | Clears clipboard → PowerShell `SendKeys Ctrl+C` → reads clipboard after 150ms wait → restores clipboard |
| `getScreenScreenshot()` | `desktopCapturer.getSources()` → screenshot as base64 PNG Data URL (1024×1024 thumbnail) |

> **Why PowerShell?** Windows doesn't expose `user32.dll` or `SendKeys` natively to Node. PowerShell acts as the bridge.

---

### `PostProcessingService.js` — The LLM Cleanup Layer

**Two modes:**

1. **Dictation Mode** (normal): Prompt tells LLM to remove fillers, fix grammar, preserve meaning.
2. **Edit Mode** (when text is selected): Prompt tells LLM to apply the spoken *instruction* to the *selected text*.

**Tone Adaptation** (`toneAdaptation: true`): Matches the active app to a tone rule:
```
Slack/Discord → "casual, conversational chat"
Gmail/Outlook → "professional email"
VS Code/Terminal → "terse and technical; preserve identifiers verbatim"
Twitter/LinkedIn → "punchy social-post style"
...
```

**Hallucination filter**: A hardcoded list of strings Whisper commonly outputs during silence (`"thank you."`, `"subscribe to my channel."`, etc.) — these are silently dropped.

**`previewPrompt()`**: Returns the full system + user prompt string without making any network call — powers the "Pipeline Debug" view in the dashboard.

---

### `PushToTalkService.js` — True Hold-to-Talk
- Electron's `globalShortcut` only fires on key **press**, not key **release** — so it can only toggle.
- **`uiohook-napi`** provides a global low-level keyboard hook (keydown/keyup events).
- The service maps label strings (`"RightCtrl"`, `"F9"`, etc.) to `UiohookKey` keycodes.
- Loaded **lazily and defensively** — if the native module fails (ABI mismatch), PTT stays disabled and the rest of the app is unaffected.
- Auto-repeat protection: `keyHeld` flag prevents multiple `onStart()` calls from key-repeat events.

---

### `CredentialService.js` — Secure API Key Storage
- Uses Electron's built-in **`safeStorage`** (backed by Windows DPAPI) instead of third-party `keytar`.
- Encrypted key is stored in `credentials.bin` in `userData`.
- When secure mode is on, `settings.json` stores an **empty string** for `groqApiKey` — the key is never written in plaintext.
- Falls back silently to plaintext mode if `safeStorage.isEncryptionAvailable()` returns false.

---

### `HistoryService.js` — Transcript History
- Stores every transcription as a **JSONL** (JSON Lines) file: `history.jsonl` in `userData`.
- Each entry contains: `rawText`, `finalText`, `context`, `macro`, `llmPrompt`, `whisperLatencyMs`, `llmLatencyMs`, `totalLatencyMs`.
- `getHistory()` reads, parses, and sorts newest-first.
- `exportToMarkdown()` converts history to a formatted `.md` file.

---

### `VoiceMacroService.js` — Voice Shortcuts
- Macros are stored as `"trigger => snippet"` lines in settings.
- A spoken phrase that **exactly matches** (normalized: lowercased, punctuation stripped) a trigger expands to the snippet and **bypasses LLM cleanup entirely**.
- Example: say "insert my email" → outputs `john@example.com` instantly.

---

### `VisionService.js` — Screen Context via AI Vision
- Sends the screenshot + window metadata to **LLaMA-4 Scout** (Groq's multimodal model).
- Gets back a 2-sentence summary of what the user is doing → injects this into the LLM cleanup prompt as additional context.
- Times out gracefully (10s) and resolves to `null` on failure — never blocks the pipeline.

---

## 🛡️ Security & Privacy Design
- **No Sileo server** — all data stays local except API calls to your configured provider.
- API key encrypted with **Windows DPAPI** when secure mode is enabled.
- Clipboard is always **restored** after `getSelectedText()` and `injectText()`.
- **Single-instance lock** prevents multiple processes running simultaneously.
- GPU cache and hardware acceleration are **disabled** to avoid Windows GPU shader cache access errors.
- `contextIsolation: true` on all windows — renderer cannot access Node APIs directly.
- `preload.js` exposes only specific, named IPC bridges (`contextBridge.exposeInMainWorld`).

---

## ⚙️ Settings System
Settings are stored in `settings.json` in Electron's `userData` directory.

| Setting | Default | Purpose |
|---|---|---|
| `hotkey` | `F9` | Primary toggle shortcut |
| `secondHotkey` | `""` | Optional second toggle key |
| `transcriptionModel` | `whisper-large-v3` | Groq Whisper model |
| `llmModel` | `llama-3.3-70b-versatile` | Groq LLM for cleanup |
| `postProcessing` | `true` | Enable/disable LLM cleanup |
| `toneAdaptation` | `true` | App-aware tone matching |
| `pushToTalkEnabled` | `false` | Hold-to-talk via uiohook |
| `liveTranscription` | `false` | Progressive interim transcription |
| `secureApiKey` | `false` | DPAPI-encrypted key storage |
| `injectText` | `true` | Auto-paste vs copy-to-clipboard |
| `customVocabulary` | `""` | Terms Whisper/LLM should spell correctly |
| `voiceMacrosText` | `""` | `trigger => snippet` lines |
| `customPrompt` | `""` | Append custom rules to LLM system prompt |
| `language` | `"en"` | Whisper language hint (prevents hallucinations) |
| `openAtLogin` | `false` | Run at Windows startup |
| `startMinimized` | `false` | Launch to tray instead of showing window |
| `onboarded` | `false` | First-run wizard completed flag |

---

## 📦 Tech Stack & Dependencies

| Library | Why it's used |
|---|---|
| `electron` v31 | App shell — gives us native OS access + Chromium renderer |
| `uiohook-napi` | Low-level global keyboard hook for true hold-to-talk |
| `electron-builder` | Packages app → NSIS installer + portable .exe |
| `sharp` | Image processing for icon generation |
| `png-to-ico` | Converts PNG app icon to .ico for Windows |
| Groq API (`https` module) | Whisper transcription + LLaMA LLM — no SDK, raw HTTPS requests |

> **No bundler (Webpack/Vite)** — the app loads plain `.js` and `.html` files directly. This keeps the build simple.

---

## 🔑 Groq API Integration

Two endpoints are used — both via raw `https.request()` (no SDK):

### Whisper Transcription
```
POST https://api.groq.com/openai/v1/audio/transcriptions
Content-Type: multipart/form-data
Body: model, file (audio.webm), response_format=verbose_json, language
```
- Audio is written to a temp `.webm` file in `%TEMP%/sileo-audio/` first (ensures clean binary), then read back for the multipart body.
- Temp files are cleaned up on success, timeout, or error.

### LLM Cleanup
```
POST https://api.groq.com/openai/v1/chat/completions
Content-Type: application/json
Body: model, temperature=0, messages=[system, user]
```
- `temperature: 0` — deterministic, no creativity needed for cleanup.

---

## 🪟 Two Windows, One App

Sileo uses two `BrowserWindow` instances:

| Window | Size | Purpose |
|---|---|---|
| **Main window** (`index.html`) | 880×680, `frame: false` | Dashboard + History + Settings |
| **Overlay** (`overlay.html`) | 92×38, transparent, always-on-top | Floating recording pill widget |

- Closing the main window **hides** it (not destroy) — stays alive in the system tray.
- The overlay is **recreated** if it gets destroyed (e.g., crashed), with a `did-finish-load` callback to retry the action.
- Both use `contextIsolation: true` + preload scripts for secure IPC.

---

## 🧠 Text Injection — How Text Gets Into Other Apps

```javascript
// 1. Write text to clipboard
clipboard.writeText(finalText);

// 2. Wait 200ms for clipboard to settle
await sleep(200);

// 3. PowerShell sends Ctrl+V to the currently focused window
powershell -Command "Add-Type -AssemblyName System.Windows.Forms;
  Start-Sleep -Milliseconds 300;
  [System.Windows.Forms.SendKeys]::SendWait('^v')"

// 4. Restore original clipboard content after 1 second
clipboard.writeText(prevClip);
```

> Why not a native Windows API? `SendKeys` is reliable across all Windows apps without requiring accessibility permissions or UI Automation setup.

---

## 🔍 Common Interview Questions — Q&A

**Q: Why Electron instead of a native Windows app?**
A: Electron allows one codebase across platforms, rapid iteration, and access to web APIs like `MediaRecorder` and `Web Audio API` for microphone handling. The tradeoff is a larger binary size (~150MB), which is acceptable for a desktop tool.

**Q: How does context-aware cleanup work?**
A: While Whisper transcribes the audio, `ContextService` simultaneously captures the active window title/process name, selected text (via Ctrl+C), and a screenshot. These are fed to the LLM as context so it knows whether to write casually (Slack), formally (Gmail), or technically (VS Code).

**Q: How is the API key kept secure?**
A: Optionally via `CredentialService` which uses Electron's `safeStorage` — a wrapper around Windows DPAPI. The key is AES-256 encrypted scoped to the OS user account. The plaintext key is never written to disk in secure mode.

**Q: How does push-to-talk differ from the toggle hotkey?**
A: Electron's `globalShortcut` only fires on keydown, making toggle (press to start, press again to stop) the only option. `uiohook-napi` registers a low-level OS keyboard hook that gives us genuine keydown AND keyup events, enabling true hold-to-talk.

**Q: What happens if the LLM call fails?**
A: The `try/catch` in the pipeline falls back gracefully — the raw Whisper transcript is used as `finalText` if post-processing throws. The overlay shows the error message briefly then hides.

**Q: How does Edit Mode work?**
A: When text is highlighted before pressing the hotkey, `ContextService.getSelectedText()` captures it via Ctrl+C. The LLM system prompt switches from "cleanup" mode to "editing" mode — the spoken dictation becomes the *instruction* and the selected text is the *target*.

**Q: How are voice macros different from LLM cleanup?**
A: Macros are pure string matching — zero LLM latency. If the spoken transcript (normalized) exactly matches a configured trigger phrase, the mapped snippet is injected directly, bypassing Whisper cleanup and LLM entirely.

**Q: What is live transcription?**
A: When enabled, the overlay flushes audio chunks to Whisper every 2.5 seconds using `whisper-large-v3-turbo` (faster model). This gives the user live interim text in the dashboard while recording continues.

**Q: How does hallucination detection work?**
A: A hardcoded list of phrases Whisper commonly outputs during silence (`"thank you."`, `"thanks for watching."`, etc.) — any transcript that exactly matches is silently dropped before the LLM step.

---

## 📁 File Locations (Runtime)

| File | Location |
|---|---|
| `settings.json` | `%APPDATA%\sileo-windows\settings.json` |
| `history.jsonl` | `%APPDATA%\sileo-windows\history.jsonl` |
| `credentials.bin` | `%APPDATA%\sileo-windows\credentials.bin` |
| Temp audio files | `%TEMP%\sileo-audio\ff-*.webm` (cleaned on quit) |

---

## 🚀 Build & Release Flow

```bash
# Development
npm run dev          # electron . --enable-logging

# Generate icons (PNG → ICO)
npm run icons        # node scripts/gen-icons.js

# Build installer + portable
npm run dist         # electron-builder --win → dist/Sileo-Setup.exe + Sileo-*-portable.exe
```

Electron Builder config (in `package.json`):
- Target: **NSIS** installer (x64) + **portable** .exe
- NSIS: user-level install, desktop shortcut, start menu shortcut
- `asarUnpack`: `uiohook-napi` unpacked from asar (native modules can't run from inside an asar archive)

---

## ✅ Quick-Reference Checklist Before Interview

- [ ] Know the full audio pipeline (F9 → mic → Whisper → LLM → paste)
- [ ] Explain the two BrowserWindows and why they exist separately
- [ ] Understand how `contextIsolation` + preload scripts enforce security
- [ ] Know the difference between toggle hotkey and push-to-talk (IPC vs uiohook)
- [ ] Explain how ContextService gathers window/selection/screenshot **in parallel**
- [ ] Describe tone adaptation rules in PostProcessingService
- [ ] Explain Edit Mode vs Dictation Mode LLM prompts
- [ ] Know that DPAPI (safeStorage) encrypts the API key in secure mode
- [ ] Understand hallucination filtering
- [ ] Know where settings and history files live on disk
