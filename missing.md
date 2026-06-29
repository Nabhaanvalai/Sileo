# Sileo for Windows — Wispr Flow Feature Parity Tracker

> Completed sections are removed. Only remaining work is listed.

---

## Runtime bug fixes (from live testing)

| Bug | Fix |
|---|---|
| Active-window context always failed (`Unrecognized token` PowerShell errors) | `ContextService` flattened a C# here-string with `.replace(/\n/g,'')`. Now writes the script to a temp `.ps1` and runs it with `-File`; also renamed the read-only automatic `$pid` → `$procId`. Verified live: returns `{Title, ProcessName}` JSON |
| Vision summary always 400'd | `llama-3.2-11b-vision-preview` was decommissioned by Groq → switched to `meta-llama/llama-4-scout-17b-16e-instruct` |
| Whisper hallucinated Devanagari on silence/noise | Transcription never sent the user's `language` setting. `transcribeAudioBuffer` now includes a `language` multipart field when set, so Whisper won't mis-detect the language |

---

## Section 2 — Intelligence ✅ DONE

| Feature | Status | Notes |
|---|---|---|
| Context-aware cleanup | ✅ Done | `getWindowTitle()` + `getSelectedText()` captured before overlay; passed to LLM as `CONTEXT:` block |
| Edit Mode / Voice commands | ✅ Done | Selected text detected via Ctrl+C snapshot → `EDIT_MODE_PROMPT` transforms it inline |
| Hallucination filtering | ✅ Done | `isHallucination()` checks `no_speech_prob` from Whisper `verbose_json` + phrase blocklist |
| Custom system prompt | ✅ Done | `settings.customSystemPrompt` fully replaces `DEFAULT_CLEANUP_PROMPT` when non-empty |

**Files changed:** `main.js`, `index.html`, `renderer.js`

---

## Section 3 — App Behaviour ✅ DONE

| Feature | Status | Notes |
|---|---|---|
| Run at Windows startup | ✅ Done | `applyLoginItemSetting()` → `app.setLoginItemSettings({ openAtLogin, args:['--hidden'] })`; "Run at Windows startup" toggle in Settings. `--hidden` skips showing the dashboard on login launch |
| System notification on done | ✅ Done | `new Notification(...)` in `audio-base64-ready`, now gated by `settings.notifyOnDone`; "Notify when done" toggle in Settings |
| Network / offline detection | ✅ Done | `assertOnline()` (`net.isOnline()`) before the transcription pipeline and in `test-api`; overlay shows "⚠ You are offline…" |
| Mic-off detection | ✅ Done | Overlay enumerates `audioinput` devices + tracks `heardAnySound`; reports "No microphone found" / "Mic muted? No audio" via new `overlay-error` IPC. Also fixed the undefined `labelEl`/`sublabel` error paths |
| Configurable API timeouts | ✅ Done | `transcriptionTimeoutMs` / `llmTimeoutMs` settings, surfaced as inputs in the Transcription & AI Cleanup cards; threaded into `transcribeAudioBuffer` and `PostProcessingService` |

**Files changed:** `main.js`, `overlay-renderer.js`, `overlay-preload.js`, `services/PostProcessingService.js`, `index.html`, `renderer.js`

> Also fixed a pre-existing bug: `save-settings` IPC called a non-existent `saveSettings()` in `main.js` (settings never persisted from the UI). Added the real `saveSettings()` that merges, persists, re-registers the hotkey, and re-applies the login item.

---

## Section 4 — Power-user Features ✅ DONE

| Feature | Status | Notes |
|---|---|---|
| Voice macros | ✅ Done | `VoiceMacroService.matchMacro()` — a spoken trigger (normalised, punctuation-stripped) expands to a snippet and skips LLM cleanup. Edited as a "trigger => snippet" textarea in Settings |
| Pipeline debug view | ✅ Done | New "Pipeline" tab shows raw transcript, exact LLM prompt (`PostProcessingService.previewPrompt()`), and cleaned output for the last run, pushed via `pipeline-debug` IPC |
| History search | ✅ Done | Keyword filter input over the history list (matches raw + final, case-insensitive); rows now keyed by entry `id` instead of array index |
| Export history | ✅ Done | Pre-existing — `HistoryService.exportToMarkdown` + "Export .md" button |
| Multiple custom shortcuts | ✅ Done | Optional second hotkey (`pushToTalkHotkey`) registered alongside the primary in `registerHotkey()`; "None" option lets the user turn it off |
| Setup Wizard / Onboarding | ✅ Done | 3-step first-launch overlay (welcome → API key + test → ready); gated by `settings.onboarded`, completed via `mark-onboarded` IPC |
| Live Streaming Transcription | ⚠️ Approximation | Groq has **no realtime/WebSocket transcription API**. Implemented as chunked progressive transcription: every 2.5 s the overlay ships the clip-so-far (`audio-live-chunk`), main re-transcribes with the turbo model and pushes interim text to a live banner (`live-transcript`). Behind the "Live transcription" toggle |
| True Audio Waveform | ✅ Done | Overlay waveform now maps the 5 bars to real FFT frequency bands with exponential smoothing, replacing the synthetic sine-pulse animation |
| Secure Credential Storage | ✅ Done | `CredentialService` uses Electron `safeStorage` (Windows DPAPI) — no native `keytar` build. Key stored encrypted in `credentials.bin`; `settings.json` holds no plaintext key in secure mode. Toggle auto-disables if the OS can't encrypt |
| Test Case Exporter | ✅ Done | `export-test-case` IPC bundles the last capture (history JSON + LLM prompt + screenshot PNG + audio webm) into a `.zip` via a dependency-free `ZipService` (STORE method, CRC-32, verified with `unzip -t`) |
| Vocabulary Notifications | ✅ Done | `VocabularyService.matchedTerms()` (whole-word match) fires a toast listing custom terms that landed in the output, behind the "Vocabulary notifications" toggle |

**New services:** `VoiceMacroService.js`, `VocabularyService.js`, `CredentialService.js`, `ZipService.js`
**Files changed:** `main.js`, `overlay-renderer.js`, `overlay-preload.js`, `preload.js`, `renderer.js`, `index.html`, `style.css`, `services/PostProcessingService.js`

> **Note on Live Streaming:** true realtime typing feedback isn't possible against Groq's REST-only transcription. The chunked approximation gives live feedback but costs extra API calls (one re-transcription every 2.5 s), so it ships off by default.