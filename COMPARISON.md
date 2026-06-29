# Sileo vs. Wispr Flow — Feature Comparison

> A factual comparison between **our app (Sileo)** — a Windows-only Electron dictation
> app built on Groq — and **Wispr Flow**, the commercial product it targets parity with.
> Sileo facts are from the code; Wispr Flow facts are from its site/docs and 2026 reviews
> (sources at bottom).

---

## At a glance

| | **Sileo (ours)** | **Wispr Flow** |
|---|---|---|
| Platforms | Windows only | Mac, Windows, iPhone, Android |
| Transcription | Groq Whisper `large-v3` (cloud) | Cloud (Baseten/OpenAI/etc.), streaming |
| AI cleanup | Groq Llama `3.3-70b` | Fine-tuned Llama (cloud) |
| Latency | Record → stop → upload → ~1–3 s | Streaming, ~700 ms p99 / 1–2 s felt |
| Offline | No (clear offline error) | No (offline error) |
| Pricing | Free / self-hosted, bring-your-own Groq key | $12–15/mo Pro; limited free tier |
| Accounts / cloud sync | None — all local | Account-based, cloud sync, Scratchpad |
| Cost model | You pay Groq per use | Subscription |

---

## Where we MATCH Wispr Flow

| Feature | Sileo | Wispr Flow |
|---|---|---|
| Global-hotkey dictation into any app | ✅ F9 (configurable) | ✅ |
| AI cleanup (filler removal, punctuation, casing) | ✅ Llama prompt | ✅ |
| **Command / Edit Mode** (select text → speak instruction → replaced) | ✅ via Ctrl+C snapshot | ✅ Command Mode |
| Voice snippets / macros (spoken cue → canned text) | ✅ `trigger => snippet` | ✅ Voice Shortcuts |
| Custom vocabulary / dictionary | ✅ manual list | ✅ (auto-learns) |
| Context awareness (active window influences output) | ✅ window title + selection + **screenshot vision** | ✅ active-window text (opt-in) |
| Auto-paste into the focused app | ✅ clipboard + SendKeys | ✅ |
| History of dictations | ✅ local `history.jsonl` + search + .md export | ✅ (cloud-synced) |
| Run at startup / tray / notifications | ✅ | ✅ |
| Push-to-talk (hold to record) | ✅ true hold-to-talk (uiohook) | ✅ |

---

## Where we are AHEAD (Sileo advantages)

- **Privacy / data ownership.** Everything is local: history is a file on disk, the
  API key can be DPAPI-encrypted (`safeStorage`), and nothing goes to a Sileo account
  because there is none. Wispr is cloud-only with an account; even its "Privacy Mode"
  only changes *retention*, not the fact that audio leaves your machine — and snippets/
  dictionaries always sync to Wispr's backend regardless.
- **Cost.** Free; you bring a Groq key and pay Groq's (low) usage cost. Wispr gates
  Command Mode and unlimited words behind $12–15/mo.
- **Power-user / debug tooling Wispr doesn't expose:**
  - **Pipeline debug view** — see raw transcript, the exact LLM prompt, and cleaned output + latencies.
  - **Test-case exporter** — bundle audio + screenshot + prompt + history into a `.zip`.
  - **Vision context** — actually screenshots the screen and feeds a vision model
    (`llama-4-scout`) a 2-sentence summary into the cleanup prompt.
- **Transparency / hackability** — no build step, all logic readable, self-modifiable.

---

## Where Wispr Flow is AHEAD (our gaps)

### Big / strategic gaps
1. **Cross-platform.** Wispr: Mac, Windows, iOS, Android. Sileo: Windows only
   (PowerShell + SendKeys + DPAPI are all Windows-specific).
2. **True streaming transcription.** Wispr streams audio and shows text with ~700 ms
   latency. Sileo records the whole clip, *then* uploads — so output appears only after
   you stop. Our "Live transcription" is a **chunked approximation** (re-transcribe the
   clip-so-far every 2.5 s) and is off by default. Groq has no realtime/WebSocket API,
   so true streaming isn't achievable on the current backend.
3. **Automatic per-app tone adaptation.** Wispr silently makes Slack casual and Gmail
   formal based on the target app — no mode switch. Sileo passes the window title into
   the prompt but does **not** adapt tone/formality per app by default.
4. **Multilingual depth.** Wispr: 100+ languages, auto-detects mid-sentence language
   switches, dedicated Hinglish model. Sileo: a single optional `language` field passed
   to Whisper; no auto-switch, no UI localization.

### Medium gaps
5. **Self-learning personal dictionary.** Wispr auto-adds a word when you correct its
   spelling. Sileo's vocabulary is a manual list (we only *notify* when a term lands).
6. **"Hey Flow" wake word / hands-free commands.** Wispr has a voice wake word and can
   open a web search (Perplexity) from a spoken question. Sileo has no wake word and no
   web-action integration.
7. **Whisper-mode (quiet speech) recognition.** Wispr explicitly handles whispered
   speech. Sileo has no special handling (would depend on raw Whisper).
8. **Cloud sync / cross-device + Scratchpad.** Wispr syncs history, snippets, and a
   scratchpad across devices. Sileo is single-device by design.
9. **Dedicated developer integrations** (Cursor, Windsurf extensions). Sileo has none.
10. **Backtracking correction** ("Tuesday, wait, Wednesday" → "Wednesday"). Wispr does
    this in its cleanup layer; Sileo relies on whatever the generic Llama prompt catches.

### Smaller / polish gaps
11. **Auto-update.** Wispr ships updates. Sileo has an `UpdateService.js` written but
    **not wired in** — dead code today.
12. **Compliance posture** (SOC 2, ISO 27001, HIPAA BAA). N/A for a local tool, but it's
    a real enterprise differentiator for Wispr.
13. **Accessibility** (screen-reader, high-contrast). Neither emphasizes it; Sileo has none.

---

## Known weaknesses in Sileo specifically (not Wispr gaps — our bugs/limits)
- **2-minute max recording** (119 s hard cap). Wispr handles long sessions.
- **Whisper hallucinations on silence** — short/silent clips can emit junk in random
  languages; mitigated only if the user sets a `language`. Setting English as default
  would help.
- **Hallucination filter is a tiny hardcoded phrase blocklist**, not ML-based.
- **Ships with a hardcoded (compromised) Groq API key** in defaults — must be replaced.
- **Text injection via clipboard + SendKeys** is fragile vs. a real input API (timing,
  clipboard restore races).

---

## Suggested priorities to close the gap
1. **Per-app tone adaptation** — cheap win; we already capture the window title, just
   instruct the LLM to adapt formality. Highest impact-to-effort.
2. **Self-learning dictionary** — detect user edits/corrections and append to vocabulary.
3. **Default language = English** (or auto-detect with a confidence floor) to kill the
   Devanagari/Swedish hallucinations.
4. **Wire up the existing `UpdateService.js`** for auto-update.
5. **Backtracking/self-correction** explicitly in the cleanup prompt.
6. (Large) **Mac support** and (large) **true streaming** — only if a streaming-capable
   transcription backend is adopted.

---

## Sources
- [Wispr Flow — Home](https://wisprflow.ai/)
- [Wispr Flow — Features](https://wisprflow.ai/features)
- [Wispr Flow — Privacy](https://wisprflow.ai/privacy) · [Data Controls](https://wisprflow.ai/data-controls) · [Privacy Mode & Data Retention](https://docs.wisprflow.ai/articles/6274675613-privacy-mode-data-retention)
- [Wispr Flow Review — Willow Voice (Jan 2026)](https://willowvoice.com/blog/wispr-flow-review-voice-dictation)
- [Wispr Flow Review 2026 — max-productive.ai](https://max-productive.ai/ai-tools/wispr-flow/)
- [Wispr Flow Review — tl;dv](https://tldv.io/blog/wisprflow/)
- [Wispr Flow 101 Guide — Sid Saladi](https://sidsaladi.substack.com/p/wispr-flow-101-the-complete-guide)
- [Wispr Flow Review (tested) — Spokenly](https://spokenly.app/blog/wispr-flow-review)
- Sileo facts: this repo's `electron-app/` source and `missing.md`.
