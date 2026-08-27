'use strict';

const {
  app, BrowserWindow, ipcMain, globalShortcut,
  Tray, Menu, nativeImage, clipboard, screen, shell, Notification, net
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { exec } = require('child_process');
const ContextService = require('./services/ContextService');
const VisionService = require('./services/VisionService');
const PostProcessingService = require('./services/PostProcessingService');
const HistoryService = require('./services/HistoryService');
const VoiceMacroService = require('./services/VoiceMacroService');
const VocabularyService = require('./services/VocabularyService');
const CredentialService = require('./services/CredentialService');
const ZipService = require('./services/ZipService');
const PushToTalkService = require('./services/PushToTalkService');
const ApiClient = require('./services/ApiClient');
// ─── Disable GPU cache & hardware acceleration ────────────────────────────────
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// ─── Single instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow    = null;
let overlayWindow = null;
let tray          = null;
let isRecording   = false;

// Artifacts of the most recent capture, kept in memory for the Test Case Exporter.
let lastCapture   = null; // { id, audioBuffer, screenshotBase64, entry }

const DEFAULTS = {
  // Never ship credentials in source; users configure the key during onboarding/settings.
  groqApiKey:         process.env.GROQ_API_KEY || '',
  apiBaseUrl:         ApiClient.DEFAULT_API_BASE_URL,
  transcriptionModel: 'whisper-large-v3',
  llmModel:           'llama-3.3-70b-versatile',
  hotkey:             'F9',
  language:           'en',   // Whisper language; 'en' default avoids hallucinated foreign scripts on silence
  postProcessing:     true,
  injectText:         true,
  startMinimized:     false,
  customPrompt:       '',
  customVocabulary:   '',
  toneAdaptation:     true,   // adapt formality to the active app (Slack casual, Gmail formal)
  openAtLogin:            false,
  notifyOnDone:           true,
  transcriptionTimeoutMs: 30000,
  llmTimeoutMs:           15000,
  voiceMacrosText:        '',     // "trigger => snippet" lines
  vocabularyNotify:       false,  // toast when a custom vocab term lands
  secureApiKey:           false,  // store key via safeStorage (DPAPI) instead of plaintext
  secondHotkey:           '',     // optional extra toggle hotkey (press to start/stop)
  pushToTalkEnabled:      false,  // true hold-to-talk via global key hook
  pushToTalkKey:          'RightCtrl', // key to hold while speaking
  liveTranscription:      false,  // chunked progressive transcription feedback
  onboarded:              false,  // first-run setup wizard completed
};

let settings = { ...DEFAULTS };
let settingsPath = '';

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeSettings(input) {
  const merged = {
    ...DEFAULTS,
    ...(input && typeof input === 'object' ? input : {}),
  };

  const stringFields = [
    'groqApiKey', 'apiBaseUrl', 'transcriptionModel', 'llmModel', 'hotkey', 'language',
    'customPrompt', 'customVocabulary', 'voiceMacrosText', 'secondHotkey',
    'pushToTalkKey',
  ];
  for (const field of stringFields) {
    if (typeof merged[field] !== 'string') merged[field] = DEFAULTS[field] || '';
  }
  for (const field of ['postProcessing', 'injectText', 'startMinimized', 'openAtLogin', 'notifyOnDone', 'toneAdaptation', 'vocabularyNotify', 'secureApiKey', 'pushToTalkEnabled', 'liveTranscription', 'onboarded']) {
    merged[field] = merged[field] === true;
  }

  merged.transcriptionTimeoutMs = clampInt(merged.transcriptionTimeoutMs, DEFAULTS.transcriptionTimeoutMs, 1000, 120000);
  merged.llmTimeoutMs = clampInt(merged.llmTimeoutMs, DEFAULTS.llmTimeoutMs, 1000, 120000);
  merged.groqApiKey = merged.groqApiKey.trim();
  try {
    const parsedBase = new URL(merged.apiBaseUrl);
    if (!['http:', 'https:'].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password) throw new Error('invalid API base URL');
    parsedBase.hash = '';
    parsedBase.search = '';
    parsedBase.pathname = parsedBase.pathname.replace(/\/+$/, '');
    merged.apiBaseUrl = parsedBase.toString().replace(/\/$/, '');
  } catch (_) {
    merged.apiBaseUrl = DEFAULTS.apiBaseUrl;
  }
  merged.hotkey = merged.hotkey.trim() || DEFAULTS.hotkey;
  merged.secondHotkey = merged.secondHotkey.trim();
  merged.pushToTalkKey = merged.pushToTalkKey.trim() || DEFAULTS.pushToTalkKey;
  return merged;
}

// ─── Temp dir for audio ───────────────────────────────────────────────────────
const TEMP_DIR = path.join(os.tmpdir(), 'sileo-audio');

function ensureTempDir() {
  try { if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true }); }
  catch (_) {}
}

function cleanupTempFiles() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      for (const f of fs.readdirSync(TEMP_DIR)) {
        try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) {}
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      settings = normalizeSettings(saved);

      // F9 is the default now.
    }

    // If secure storage is enabled, hydrate the API key from the encrypted file
    // (settings.json holds no plaintext key in that mode).
    if (settings.secureApiKey) {
      const secureKey = CredentialService.loadApiKey();
      if (secureKey) settings.groqApiKey = secureKey;
    }
  } catch (e) {
    console.error('[Sileo] Settings load error:', e.message);
  }
}

function persistSettings() {
  try {
    // In secure mode, never write the plaintext key to settings.json.
    const toWrite = { ...settings };
    if (settings.secureApiKey) toWrite.groqApiKey = '';
    fs.writeFileSync(settingsPath, JSON.stringify(toWrite, null, 2));
    return true;
  } catch (e) {
    console.error('[Sileo] Settings save error:', e.message);
    return false;
  }
}

// Reflects the current API key into / out of encrypted storage based on the
// secureApiKey toggle. Returns true if the requested mode is in effect.
function syncSecureKey() {
  if (settings.secureApiKey) {
    if (!CredentialService.isAvailable()) {
      console.warn('[Sileo] safeStorage unavailable — falling back to plaintext key');
      settings.secureApiKey = false;
      return false;
    }
    if (!CredentialService.saveApiKey(settings.groqApiKey)) {
      console.warn('[Sileo] Could not persist API key securely; keeping plaintext mode enabled');
      settings.secureApiKey = false;
      return false;
    }
    return true;
  }
  // Secure mode off → make sure no stale encrypted key lingers.
  CredentialService.clear();
  return false;
}

// Merge incoming settings, persist, and re-apply anything with side effects.
function saveSettings(incoming) {
  try {
    settings = normalizeSettings({
      ...settings,
      ...(incoming && typeof incoming === 'object' ? incoming : {}),
    });
    syncSecureKey();
    if (!persistSettings()) return { ok: false, error: 'Could not save settings to disk' };
    registerHotkey();
    applyPushToTalk();
    applyLoginItemSetting();
    refreshTrayMenu();
    console.log('[Sileo] Settings saved');
    return {
      ok: true,
      secureKeyActive: !!settings.secureApiKey,
      apiBaseUrl: settings.apiBaseUrl,
    };
  } catch (e) {
    console.error('[Sileo] saveSettings error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ─── Run at Windows startup ────────────────────────────────────────────────────
function applyLoginItemSetting() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.openAtLogin,
      path: process.execPath,
      args: ['--hidden'],
    });
  } catch (e) {
    console.error('[Sileo] Login item error:', e.message);
  }
}

// ─── Offline detection ─────────────────────────────────────────────────────────
function assertOnline() {
  if (!net.isOnline()) {
    throw new Error('You are offline — check your connection');
  }
}

function assertApiKey() {
  if (!ApiClient.isUsableApiKey(settings.groqApiKey, settings.apiBaseUrl)) {
    throw new Error(ApiClient.requiresApiKey(settings.apiBaseUrl)
      ? 'Groq API key is not configured — open Settings to add one'
      : 'Provider API key contains invalid characters');
  }
}

// ─── App / tray icons ─────────────────────────────────────────────────────────
const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.ico');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'icon-32.png');

function makeTrayIcon() {
  // Prefer the generated Sileo logo; fall back to a tiny embedded glyph if the
  // assets haven't been generated (e.g. running from a bare checkout).
  try {
    const img = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (!img.isEmpty()) return img;
  } catch (_) {}
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVQ4y2P4' +
    'z8DwnwEPYMQn8J+BgYGRkZGRkZGRkZGBGgYAAOgCBb8Z+44AAAAASUVORK5CYII='
  );
}

// ─── Overlay window ───────────────────────────────────────────────────────────
function createOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width:       92,
    height:      38,
    x:           Math.floor((width - 92) / 2),
    y:           0,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    movable:     true,
    focusable:   false,
    hasShadow:   false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,  // Allow Buffer in preload
      preload: path.join(__dirname, 'overlay-preload.js'),
    },
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.hide();

  // Open DevTools in dev for debugging
  // overlayWindow.webContents.openDevTools({ mode: 'detach' });

  overlayWindow.on('closed', () => { overlayWindow = null; });
  console.log('[Sileo] Overlay window created');
}

// ─── Main window ──────────────────────────────────────────────────────────────
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  mainWindow = new BrowserWindow({
    width:     880,
    height:    680,
    minWidth:  720,
    minHeight: 560,
    frame:     false,
    backgroundColor: '#F8F6F2',
    show:      false,
    icon:      APP_ICON_PATH,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  console.log('[Sileo] Main window created');
}

// ─── System tray ──────────────────────────────────────────────────────────────
function buildTrayMenu() {
  const key = settings.hotkey || 'F9';
  return Menu.buildFromTemplate([
    { label: 'Sileo', enabled: false },
    { type: 'separator' },
    {
      label: isRecording ? 'Stop Recording' : `Start Recording (${key})`,
      click: () => triggerRecording(),
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Sileo',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function setupTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Sileo – AI Dictation (F9)');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  console.log('[Sileo] Tray created');
}

// ─── Global hotkey ────────────────────────────────────────────────────────────
function registerHotkey() {
  globalShortcut.unregisterAll();
  const key = settings.hotkey || 'F9';
  try {
    const ok = globalShortcut.register(key, () => {
      console.log('[Sileo] Hotkey pressed:', key);
      triggerRecording();
    });
    console.log(`[Sileo] Hotkey ${key}: ${ok ? 'registered' : 'FAILED'}`);
  } catch (e) {
    console.error('[Sileo] Hotkey error:', e.message);
  }

  // Optional second toggle hotkey (press to start / press again to stop).
  // Only registered when set and distinct from the primary key.
  const second = (settings.secondHotkey || '').trim();
  if (second && second !== key) {
    try {
      const ok2 = globalShortcut.register(second, () => {
        console.log('[Sileo] Second hotkey pressed:', second);
        triggerRecording();
      });
      console.log(`[Sileo] Second hotkey ${second}: ${ok2 ? 'registered' : 'FAILED'}`);
    } catch (e) {
      console.error('[Sileo] Second hotkey error:', e.message);
    }
  }
}

// ─── Push-to-talk (true hold-to-talk via global key hook) ──────────────────────
function applyPushToTalk() {
  if (settings.pushToTalkEnabled && settings.pushToTalkKey) {
    const ok = PushToTalkService.enable(
      settings.pushToTalkKey,
      () => startRecordingExplicit(),
      () => stopRecordingExplicit()
    );
    console.log(`[Sileo] Push-to-talk (${settings.pushToTalkKey}): ${ok ? 'enabled' : 'unavailable'}`);
  } else {
    PushToTalkService.disable();
  }
}

// ─── Recording toggle ─────────────────────────────────────────────────────────
// Returns true if the overlay is ready to use right now. If it had to be
// recreated, it loads asynchronously and `onReady` is invoked once when ready.
function ensureOverlayReady(onReady) {
  if (overlayWindow && !overlayWindow.isDestroyed()) return true;
  console.log('[Sileo] Recreating overlay...');
  createOverlay();
  overlayWindow.webContents.once('did-finish-load', () => {
    console.log('[Sileo] Overlay loaded, retrying');
    onReady();
  });
  return false;
}

function startRecordingExplicit() {
  if (isRecording) return;
  // If the overlay isn't ready, bail now — it will call us back once loaded.
  if (!ensureOverlayReady(startRecordingExplicit)) return;
  console.log('[Sileo] Starting recording');
  isRecording = true;
  updateTrayState();
  overlayWindow.show();
  overlayWindow.webContents.send('recording-state', { recording: true, status: 'Recording…' });
  overlayWindow.webContents.send('start-recording', { liveTranscription: !!settings.liveTranscription });
  refreshTrayMenu();
}

function stopRecordingExplicit() {
  if (!isRecording) return;
  if (!overlayWindow || overlayWindow.isDestroyed()) { isRecording = false; return; }
  console.log('[Sileo] Stopping recording');
  isRecording = false;
  updateTrayState();
  overlayWindow.webContents.send('recording-state', { recording: false, status: 'Processing…' });
  overlayWindow.webContents.send('stop-recording');
  refreshTrayMenu();
}

// Toggle entry point for the press-to-toggle hotkeys (F9 / second hotkey) and tray.
function triggerRecording() {
  if (isRecording) stopRecordingExplicit();
  else startRecordingExplicit();
}

function updateTrayState() {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(isRecording
    ? 'Sileo – Recording… (F9 to stop)'
    : 'Sileo – AI Dictation (F9)');
}

// ─── Text injection (Windows) ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function injectTextIntoActiveWindow(text) {
  let prevClip = '';
  try { prevClip = clipboard.readText() || ''; } catch (_) {}

  clipboard.writeText(text);
  await sleep(200);

  return new Promise((resolve) => {
    const ps = `powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('^v')"`;

    exec(ps, { timeout: 5000, windowsHide: true }, (err) => {
      if (err) console.error('[Sileo] SendKeys error:', err.message);
      setTimeout(() => {
        try { clipboard.writeText(prevClip); } catch (_) {}
      }, 1000);
      resolve();
    });
  });
}

// ─── Groq: Transcription ─────────────────────────────────────────────────────
async function transcribeAudioBuffer(audioData, apiKey, model, timeoutMs, language, apiBaseUrl) {
  if (!ApiClient.isUsableApiKey(apiKey, apiBaseUrl)) {
    throw new Error(ApiClient.requiresApiKey(apiBaseUrl)
      ? 'Groq API key is not configured — open Settings to add one'
      : 'Provider API key contains invalid characters');
  }
  const boundary = 'FFBound' + Date.now() + Math.random().toString(36).slice(2);

  if (!Buffer.isBuffer(audioData)) audioData = Buffer.from(audioData);
  console.log(`[Sileo] Transcribing ${audioData.length} bytes with ${model}`);
  if (audioData.length < 100) throw new Error(`Audio too small (${audioData.length} bytes)`);

  ensureTempDir();
  const tmpFile = path.join(TEMP_DIR, `ff-${Date.now()}.webm`);
  try {
    // Write to a temp file first, then read back to ensure clean binary data.
    fs.writeFileSync(tmpFile, audioData);
    const fileData = fs.readFileSync(tmpFile);

    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`));
    const lang = (language || '').trim();
    if (lang) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${lang}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\n`));
    parts.push(fileData);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const response = await ApiClient.requestMultipart(
      apiBaseUrl,
      'audio/transcriptions',
      Buffer.concat(parts),
      boundary,
      apiKey,
      timeoutMs || 30000,
    );

    console.log(`[Sileo] Transcription response: ${response.statusCode}`);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.error('[Sileo] Transcription error body:', response.body.slice(0, 300));
      throw new Error(`Transcription API ${response.statusCode}: ${response.body.slice(0, 150)}`);
    }

    try {
      const json = JSON.parse(response.body);
      console.log('[Sileo] Transcript:', json.text?.slice(0, 80));
      return json.text || '';
    } catch (_) {
      throw new Error('Invalid transcription response');
    }
  } catch (e) {
    throw new Error(e.message || 'Transcription request failed');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ─── Groq: LLM cleanup ───────────────────────────────────────────────────────
// Moved to PostProcessingService

// ─── IPC: Live (interim) transcription ───────────────────────────────────────
let liveBusy = false;
ipcMain.on('audio-live-chunk', async (_, base64String) => {
  if (liveBusy || !isRecording) return; // skip overlapping / stale snapshots
  if (!net.isOnline() || !ApiClient.isUsableApiKey(settings.groqApiKey, settings.apiBaseUrl)) return;
  liveBusy = true;
  try {
    const buf = Buffer.from(base64String, 'base64');
    // Use the fast turbo model for interim passes regardless of the final model.
    const interim = await transcribeAudioBuffer(
      buf, settings.groqApiKey, 'whisper-large-v3-turbo', settings.transcriptionTimeoutMs, settings.language, settings.apiBaseUrl
    );
    if (interim && interim.trim() && isRecording) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('live-transcript', interim.trim());
      }
    }
  } catch (e) {
    console.warn('[Sileo] Live chunk error:', e.message);
  } finally {
    liveBusy = false;
  }
});

// ─── IPC: Audio pipeline ─────────────────────────────────────────────────────
ipcMain.on('audio-base64-ready', async (_, base64String) => {
  // Decode base64 → Buffer (guaranteed correct binary data)
  const audioBuffer = Buffer.from(base64String, 'base64');
  console.log('[Sileo] Audio received: base64 length=' + base64String.length + ', decoded bytes=' + audioBuffer.length);

  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.webContents.send('recording-state', { recording: false, status: 'Transcribing…' });

  try {
    assertOnline();
    assertApiKey();

    const startTime = Date.now();
    // Run transcription and context gathering in parallel
    const [text, winInfo, selText, screenshotBase64] = await Promise.all([
      transcribeAudioBuffer(audioBuffer, settings.groqApiKey, settings.transcriptionModel, settings.transcriptionTimeoutMs, settings.language, settings.apiBaseUrl),
      ContextService.getActiveWindowInfo(),
      ContextService.getSelectedText(),
      ContextService.getScreenScreenshot()
    ]);

    const whisperLatency = Date.now() - startTime;

    let visionSummary = null;
    if (screenshotBase64) {
      // While transcription is returning, we can quickly get the vision summary if it's not done yet.
      // But actually since we waited for transcription, let's just await the vision summary now.
      visionSummary = await VisionService.analyzeVisualContext(settings.groqApiKey, screenshotBase64, winInfo, settings.apiBaseUrl);
    }

    const contextInfo = { window: winInfo, selectedText: selText, visionSummary };
    console.log('[Sileo] Context:', contextInfo);

    if (!text || !text.trim()) {
      overlayWindow.webContents.send('recording-state', { recording: false, status: 'No speech detected' });
      setTimeout(() => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); }, 2000);
      return;
    }

    let finalText = text;
    let llmLatency = 0;
    let macroUsed = null;

    if (PostProcessingService.isHallucination(text)) {
      console.log('[Sileo] Hallucination detected. Dropping.');
      overlayWindow.webContents.send('recording-state', { recording: false, status: 'Ignored (Silence)' });
      setTimeout(() => { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); }, 2000);
      return;
    }

    // Voice macros: a spoken trigger phrase expands to a snippet and skips LLM cleanup.
    const macro = VoiceMacroService.matchMacro(text, settings);
    if (macro) {
      console.log('[Sileo] Voice macro matched:', macro.trigger);
      finalText = macro.snippet;
      macroUsed = macro.trigger;
    }

    if (!macroUsed && settings.postProcessing) {
      overlayWindow.webContents.send('recording-state', { recording: false, status: 'Cleaning up…' });
      try {
        const llmStart = Date.now();
        const cleaned = await PostProcessingService.processTranscript(text, settings, contextInfo);
        if (cleaned && cleaned.trim()) finalText = cleaned;
        llmLatency = Date.now() - llmStart;
      } catch (e) {
        console.warn('[Sileo] Post-process failed:', e.message);
      }
    }

    // Save to history (llmPrompt powers the Pipeline debug view).
    const llmPrompt = settings.postProcessing && !macroUsed
      ? PostProcessingService.previewPrompt(text, settings, contextInfo)
      : null;

    const entry = HistoryService.addEntry({
      rawText: text,
      finalText: finalText,
      context: contextInfo,
      macro: macroUsed,
      llmPrompt,
      whisperLatencyMs: whisperLatency,
      llmLatencyMs: llmLatency,
      totalLatencyMs: Date.now() - startTime
    });

    // Keep this capture's artifacts in memory for the Test Case Exporter.
    lastCapture = { id: entry.id, audioBuffer, screenshotBase64, entry };

    console.log('[Sileo] Final text:', finalText.slice(0, 80));
    overlayWindow.webContents.send('recording-state', { recording: false, status: macroUsed ? 'Macro ✓' : 'Done ✓' });

    // Push to dashboard (with debug payload for the Pipeline view).
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('new-transcript', finalText);
      mainWindow.webContents.send('pipeline-debug', {
        rawText: text,
        llmPrompt,
        finalText,
        macro: macroUsed,
        whisperLatencyMs: whisperLatency,
        llmLatencyMs: llmLatency,
      });
    }

    // Vocabulary notifications: toast when a custom term landed in the output.
    if (settings.vocabularyNotify) {
      const matched = VocabularyService.matchedTerms(finalText, settings);
      if (matched.length && Notification.isSupported()) {
        new Notification({
          title: 'Vocabulary applied',
          body: matched.slice(0, 5).join(', '),
          silent: true,
        }).show();
      }
    }

    // Inject or copy
    if (settings.injectText) {
      await injectTextIntoActiveWindow(finalText);
    } else {
      clipboard.writeText(finalText);
    }

    // Notification
    if (settings.notifyOnDone && Notification.isSupported()) {
      new Notification({
        title: 'Sileo',
        body: text.length > 80 ? text.slice(0, 80) + '…' : text,
        silent: true,
      }).show();
    }

    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    }, 1500);

  } catch (err) {
    console.error('[Sileo] Pipeline error:', err.message);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const msg = err.message.length > 55 ? err.message.slice(0, 55) + '…' : err.message;
      overlayWindow.webContents.send('recording-state', { recording: false, status: '⚠ ' + msg });
      setTimeout(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
      }, 4000);
    }
  }
});

ipcMain.on('overlay-cancel', () => {
  console.log('[Sileo] Recording cancelled');
  isRecording = false;
  updateTrayState();
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  refreshTrayMenu();
});

// Surfaced from the overlay renderer (e.g. no mic, muted mic, capture error).
ipcMain.on('overlay-error', (_, message) => {
  console.warn('[Sileo] Overlay error:', message);
  isRecording = false;
  updateTrayState();
  refreshTrayMenu();
  const msg = String(message || 'Recording error');
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('recording-state', { recording: false, status: '⚠ ' + msg });
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    }, 3500);
  }
  if (settings.notifyOnDone && Notification.isSupported()) {
    new Notification({ title: 'Sileo', body: msg, silent: true }).show();
  }
});

// ─── IPC: Settings & Tools ─────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_, s) => saveSettings(s));
ipcMain.handle('get-history', () => HistoryService.getHistory());
ipcMain.handle('clear-history', () => HistoryService.clearHistory());
ipcMain.handle('export-history', async () => {
  const { dialog } = require('electron');
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export History',
    defaultPath: 'Sileo-History.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (filePath) {
    HistoryService.exportToMarkdown(filePath);
    return filePath;
  }
  return null;
});

// Secure storage availability (lets the UI disable the toggle if unsupported).
ipcMain.handle('secure-storage-available', () => CredentialService.isAvailable());

// Push-to-talk availability (native key-hook module loaded?).
ipcMain.handle('ptt-available', () => PushToTalkService.isAvailable());

// Mark the onboarding wizard as completed.
ipcMain.handle('mark-onboarded', () => { saveSettings({ onboarded: true }); return true; });

// Test Case Exporter: bundle the most recent capture (history JSON + LLM prompt +
// screenshot PNG + audio webm) into a debug .zip.
ipcMain.handle('export-test-case', async () => {
  const { dialog } = require('electron');
  if (!lastCapture) {
    return { ok: false, error: 'No capture yet — record something first.' };
  }

  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Test Case',
    defaultPath: `Sileo-TestCase-${lastCapture.id}.zip`,
    filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
  });
  if (!filePath) return { ok: false, error: null }; // user cancelled

  try {
    const entries = [
      { name: 'history.json', data: JSON.stringify(lastCapture.entry, null, 2) },
    ];
    if (lastCapture.entry?.llmPrompt) {
      entries.push({ name: 'llm-prompt.txt', data: lastCapture.entry.llmPrompt });
    }
    if (lastCapture.audioBuffer && lastCapture.audioBuffer.length) {
      entries.push({ name: 'audio.webm', data: lastCapture.audioBuffer });
    }
    if (lastCapture.screenshotBase64) {
      // Strip the data URL prefix → raw PNG bytes.
      const b64 = String(lastCapture.screenshotBase64).replace(/^data:image\/\w+;base64,/, '');
      entries.push({ name: 'screenshot.png', data: Buffer.from(b64, 'base64') });
    }

    const zip = ZipService.createZip(entries);
    fs.writeFileSync(filePath, zip);
    return { ok: true, filePath };
  } catch (e) {
    console.error('[Sileo] Test case export error:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('copy-text', (_, t) => { clipboard.writeText(t); return true; });
ipcMain.handle('win-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('win-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
});
ipcMain.handle('win-close', () => { if (mainWindow) mainWindow.hide(); });
ipcMain.handle('open-url', (_, url) => shell.openExternal(url));

// API test
ipcMain.handle('test-api', async () => {
  const apiKey = settings.groqApiKey;
  if (!ApiClient.isUsableApiKey(apiKey, settings.apiBaseUrl)) {
    return { ok: false, error: ApiClient.requiresApiKey(settings.apiBaseUrl) ? 'Invalid Groq API key. Must start with gsk_' : 'Invalid provider API key' };
  }
  if (!net.isOnline()) {
    return { ok: false, error: 'You are offline — check your connection' };
  }
  try {
    const response = await ApiClient.requestJson(
      settings.apiBaseUrl,
      'chat/completions',
      {
        model: settings.llmModel || 'llama-3.3-70b-versatile',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Say ok' }],
      },
      apiKey,
      10000,
    );
    return response.statusCode >= 200 && response.statusCode < 300
      ? { ok: true, message: 'API connected!' }
      : { ok: false, error: `API ${response.statusCode}: ${response.body.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, error: e.message || 'API request failed' };
  }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  console.log('[Sileo] App starting...');
  loadSettings();
  applyLoginItemSetting();
  ensureTempDir();
  createMainWindow();
  createOverlay();
  setupTray();
  registerHotkey();
  applyPushToTalk();

  // Show window on launch, unless minimised by setting or launched at login (--hidden).
  const launchedHidden = process.argv.includes('--hidden');
  if (!settings.startMinimized && !launchedHidden) {
    mainWindow.show();
  }

  console.log('[Sileo] Ready. Settings:', settingsPath);
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => { /* keep alive in tray */ });
app.on('before-quit', () => { app.isQuitting = true; cleanupTempFiles(); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  PushToTalkService.disable();
});

process.on('uncaughtException', (e) => console.error('[Sileo] CRASH:', e));
process.on('unhandledRejection', (e) => console.error('[Sileo] REJECTION:', e));
