'use strict';
/* global electronAPI */

// ─── State ────────────────────────────────────────────────────────────────────
let settings = {};
let history  = [];

// ─── DOM ──────────────────────────────────────────────────────────────────────
const navItems      = document.querySelectorAll('.nav-item');
const panels        = document.querySelectorAll('.panel');
const statusDot     = document.getElementById('status-dot');
const statusLabel   = document.getElementById('status-label');
const latestBody    = document.getElementById('latest-body');
const latestMeta    = document.getElementById('latest-meta');
const btnCopyLatest = document.getElementById('btn-copy-latest');
const statTotal     = document.getElementById('stat-total');
const statWords     = document.getElementById('stat-words');
const statToday     = document.getElementById('stat-today');
const historyList   = document.getElementById('history-list');
const btnClearHist  = document.getElementById('btn-clear-history');
const hotkeyDisplay = document.getElementById('hotkey-display');
const hotkeyDisplay2= document.getElementById('hotkey-display2');

// Settings inputs
const inpKey       = document.getElementById('inp-key');
const inpApiBase   = document.getElementById('inp-api-base');
const inpHotkey    = document.getElementById('inp-hotkey');
const inpTxModel   = document.getElementById('inp-tx-model');
const inpLang      = document.getElementById('inp-lang');
const inpLlm       = document.getElementById('inp-llm');
const inpVocab     = document.getElementById('inp-vocab');
const togPP        = document.getElementById('tog-pp');
const togInject    = document.getElementById('tog-inject');
const togTray      = document.getElementById('tog-tray');
const togStartup   = document.getElementById('tog-startup');
const togNotify    = document.getElementById('tog-notify');
const inpTxTimeout = document.getElementById('inp-tx-timeout');
const inpLlmTimeout= document.getElementById('inp-llm-timeout');
const inpHotkey2   = document.getElementById('inp-hotkey2');
const togPtt       = document.getElementById('tog-ptt');
const inpPttKey    = document.getElementById('inp-ptt-key');
const hintPtt      = document.getElementById('hint-ptt');
const inpMacros    = document.getElementById('inp-macros');
const togSecure    = document.getElementById('tog-secure');
const togVocabNotify = document.getElementById('tog-vocab-notify');
const togLive      = document.getElementById('tog-live');
const togTone      = document.getElementById('tog-tone');
const togEditMode  = document.getElementById('tog-edit-mode');
const togDevMode   = document.getElementById('tog-dev-mode');
const togAutoLearn = document.getElementById('tog-auto-learn');
const inpCustomPrompt = document.getElementById('inp-custom-prompt');
const inpApiBaseUrl   = document.getElementById('inp-api-base-url');
const inpTxApiUrl     = document.getElementById('inp-tx-api-url');
const hintSecure   = document.getElementById('hint-secure');
const btnSave      = document.getElementById('btn-save');
const saveMsg      = document.getElementById('save-msg');
const btnToggleKey = document.getElementById('btn-toggle-key');
const linkGroq     = document.getElementById('link-groq');
const btnTestApi   = document.getElementById('btn-test-api');
const testApiMsg   = document.getElementById('test-api-msg');

// History search
const inpHistorySearch = document.getElementById('inp-history-search');

// Pipeline debug view
const dbgRaw       = document.getElementById('dbg-raw');
const dbgPrompt    = document.getElementById('dbg-prompt');
const dbgFinal     = document.getElementById('dbg-final');
const dbgWhisperMs = document.getElementById('dbg-whisper-ms');
const dbgLlmMs     = document.getElementById('dbg-llm-ms');
const btnExportTestCase = document.getElementById('btn-export-testcase');

// Live transcript banner
const liveBanner     = document.getElementById('live-banner');
const liveBannerText = document.getElementById('live-banner-text');

// Onboarding
const onboarding   = document.getElementById('onboarding');

// History search state
let historyFilter = '';

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  // Wire up navigation / window controls FIRST so the UI is always interactive,
  // even if loading or rendering data throws below.
  setupNav();
  setupTitlebar();
  setupSettingsUI();
  setupHistoryUI();
  setupPipelineUI();

  try {
    settings = await electronAPI.getSettings();
    history = await electronAPI.getHistory();
  } catch (e) {
    console.error('[Sileo] Failed to load settings/history:', e);
    settings = settings || {};
    history = history || [];
  }

  // Each render step is isolated — one failure must not block the others.
  try { populateSettings(); } catch (e) { console.error('[Sileo] populateSettings:', e); }
  try { rebuildHistory(); }   catch (e) { console.error('[Sileo] rebuildHistory:', e); }
  try { refreshStats(); }     catch (e) { console.error('[Sileo] refreshStats:', e); }
  try { setupOnboarding(); }  catch (e) { console.error('[Sileo] setupOnboarding:', e); }

  // New transcript pushed from overlay pipeline
  electronAPI.onNewTranscript(async (text) => {
    try {
      history = await electronAPI.getHistory();
      rebuildHistory();
      showLatest(text);
      refreshStats();
      setStatus('idle');
      hideLiveBanner();
    } catch (e) { console.error('[Sileo] onNewTranscript:', e); }
  });

  // Pipeline debug payload
  electronAPI.onPipelineDebug((d) => { try { updatePipelineDebug(d); } catch (e) { console.error(e); } });

  // Live (interim) transcript
  electronAPI.onLiveTranscript((t) => { try { showLiveBanner(t); } catch (e) { console.error(e); } });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNav() {
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      navItems.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ─── Titlebar ─────────────────────────────────────────────────────────────────
function setupTitlebar() {
  document.getElementById('btn-min').addEventListener('click', () => electronAPI.minimize());
  document.getElementById('btn-max').addEventListener('click', () => electronAPI.maximize());
  document.getElementById('btn-cls').addEventListener('click', () => electronAPI.close());
}

// ─── Status indicator ─────────────────────────────────────────────────────────
function setStatus(state) {
  statusDot.className = 'status-dot ' + state;
  statusLabel.textContent =
    state === 'recording'  ? 'Recording' :
    state === 'processing' ? 'Processing' : 'Idle';
}

// ─── Latest transcript ────────────────────────────────────────────────────────
function showLatest(text) {
  latestBody.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = text;
  latestBody.appendChild(p);

  const words = text.split(/\s+/).filter(Boolean).length;
  latestMeta.style.display = '';
  latestMeta.textContent = `${words} word${words !== 1 ? 's' : ''} · ${text.length} chars · ${new Date().toLocaleTimeString()}`;
}

btnCopyLatest.addEventListener('click', async () => {
  const txt = latestBody.querySelector('p')?.textContent;
  if (txt) {
    await electronAPI.copyText(txt);
    btnCopyLatest.style.color = '#5C9B6B';
    setTimeout(() => { btnCopyLatest.style.color = ''; }, 1500);
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
function refreshStats() {
  const todayStr = new Date().toDateString();
  let tw = 0, tc = 0;
  history.forEach(h => {
    const text = h.finalText || h.text || h.rawText || '';
    const wc = text.split(/\s+/).filter(Boolean).length;
    tw += wc;
    const when = h.timestamp || h.time;
    if (when && new Date(when).toDateString() === todayStr) tc++;
  });
  statTotal.textContent = history.length;
  statWords.textContent = tw;
  statToday.textContent = tc;
}

// ─── History ──────────────────────────────────────────────────────────────────
function rebuildHistory() {
  if (history.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C8A97E" stroke-width="1.2"><polyline points="14 2 14 8 20 8"/><path d="M20 20H4V4h10l6 6v10z"/></svg>
        <p>No recordings yet.<br><kbd>F9</kbd> to start dictating.</p>
      </div>`;
    return;
  }

  // Apply keyword filter (matches raw + final text, case-insensitive).
  const q = historyFilter.trim().toLowerCase();
  const visible = q
    ? history.filter(h =>
        `${h.finalText || ''} ${h.rawText || h.text || ''}`.toLowerCase().includes(q))
    : history;

  if (visible.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <p>No transcripts match “${esc(historyFilter)}”.</p>
      </div>`;
    return;
  }

  historyList.innerHTML = visible.map((h) => {
    const d = new Date(h.timestamp);
    const latency = h.totalLatencyMs ? Math.round(h.totalLatencyMs / 1000) + 's' : '';
    const macroTag = h.macro ? `<span style="opacity:0.6">⚡ ${esc(h.macro)}</span> · ` : '';
    return `
      <div class="history-item" data-id="${esc(h.id || '')}">
        <div class="hi-time">${macroTag}${d.toLocaleDateString()} ${d.toLocaleTimeString()} <span style="opacity:0.5;float:right">${latency}</span></div>
        <div class="hi-text">${esc(h.finalText || h.text || '')}</div>
      </div>`;
  }).join('');

  historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const item = history.find(h => String(h.id) === id) || {};
      showLatest(item.finalText || item.text || '');
      // Switch to home
      navItems.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="home"]').classList.add('active');
      document.getElementById('panel-home').classList.add('active');
    });
  });
}

function setupHistoryUI() {
  btnClearHist.addEventListener('click', async () => {
    if (!history.length) return;
    if (!window.confirm('Clear all saved transcription history? This cannot be undone.')) return;

    const result = await electronAPI.clearHistory();
    if (!result?.ok) {
      console.error('[Sileo] Failed to clear history:', result?.error);
      return;
    }

    history = [];
    rebuildHistory();
    refreshStats();
    showLatest(''); // clear latest too
    latestBody.innerHTML = '<span class="placeholder-text">Nothing yet — press <kbd>F9</kbd> to record your first dictation.</span>';
    latestMeta.style.display = 'none';
  });

  const btnExportHist = document.getElementById('btn-export-history');
  if (btnExportHist) {
    btnExportHist.addEventListener('click', async () => {
      const file = await electronAPI.exportHistory();
      if (file) {
        btnExportHist.textContent = '✓ Exported';
        setTimeout(() => { btnExportHist.textContent = 'Export .md'; }, 2000);
      }
    });
  }

  // History search
  if (inpHistorySearch) {
    inpHistorySearch.addEventListener('input', () => {
      historyFilter = inpHistorySearch.value;
      rebuildHistory();
    });
  }
}

// ─── Pipeline debug view ───────────────────────────────────────────────────────
function updatePipelineDebug(d) {
  if (!d || !dbgRaw) return;
  dbgRaw.textContent    = d.rawText || '—';
  dbgPrompt.textContent = d.llmPrompt || (d.macro ? `(voice macro: ${d.macro})` : '(post-processing off)');
  dbgFinal.textContent  = d.finalText || '—';
  dbgWhisperMs.textContent = d.whisperLatencyMs ? `${d.whisperLatencyMs} ms` : '';
  dbgLlmMs.textContent     = d.llmLatencyMs ? `${d.llmLatencyMs} ms` : '';
}

function setupPipelineUI() {
  if (btnExportTestCase) {
    btnExportTestCase.addEventListener('click', async () => {
      btnExportTestCase.disabled = true;
      const prev = btnExportTestCase.textContent;
      btnExportTestCase.textContent = 'Exporting…';
      try {
        const r = await electronAPI.exportTestCase();
        btnExportTestCase.textContent = r?.ok ? '✓ Exported' : (r?.error ? '✗ ' + r.error : prev);
      } catch (e) {
        btnExportTestCase.textContent = '✗ ' + e.message;
      }
      setTimeout(() => { btnExportTestCase.textContent = prev; btnExportTestCase.disabled = false; }, 2600);
    });
  }
}

// ─── Live transcript banner ────────────────────────────────────────────────────
function showLiveBanner(text) {
  if (!liveBanner) return;
  liveBannerText.textContent = text;
  liveBanner.style.display = 'flex';
}
function hideLiveBanner() {
  if (liveBanner) liveBanner.style.display = 'none';
}

// ─── Onboarding wizard ─────────────────────────────────────────────────────────
function setupOnboarding() {
  if (!onboarding) return;

  // Show on first launch (settings.onboarded falsy).
  if (!settings.onboarded) onboarding.style.display = 'flex';

  let step = 0;
  const steps = onboarding.querySelectorAll('.ob-step');
  const dots  = onboarding.querySelectorAll('.ob-dot');

  function render() {
    steps.forEach(s => s.classList.toggle('active', Number(s.dataset.step) === step));
    dots.forEach(d => d.classList.toggle('active', Number(d.dataset.step) <= step));
  }

  onboarding.querySelectorAll('.ob-next').forEach(b => b.addEventListener('click', () => {
    step = Math.min(step + 1, steps.length - 1);
    render();
  }));
  onboarding.querySelectorAll('.ob-back').forEach(b => b.addEventListener('click', () => {
    step = Math.max(step - 1, 0);
    render();
  }));

  const obLink = document.getElementById('ob-link-groq');
  if (obLink) obLink.addEventListener('click', (e) => { e.preventDefault(); electronAPI.openUrl('https://console.groq.com/keys'); });

  const obKey = document.getElementById('ob-key');
  const obTest = document.getElementById('ob-test');
  const obTestMsg = document.getElementById('ob-test-msg');
  if (obTest) {
    obTest.addEventListener('click', async () => {
      // Save the key first so the main process tests the right one.
      const key = (obKey.value || '').trim();
      if (!key) { obTestMsg.textContent = 'Enter a key first'; return; }
      await electronAPI.saveSettings({ ...settings, groqApiKey: key });
      settings.groqApiKey = key;
      obTestMsg.textContent = 'Testing…';
      const r = await electronAPI.testApi();
      obTestMsg.textContent = r.ok ? '✓ ' + r.message : '✗ ' + r.error;
      obTestMsg.style.color = r.ok ? '#5C9B6B' : '#C0504D';
    });
  }

  const obFinish = document.getElementById('ob-finish');
  if (obFinish) {
    obFinish.addEventListener('click', async () => {
      const key = (obKey?.value || '').trim();
      if (key) {
        settings.groqApiKey = key;
        await electronAPI.saveSettings({ ...settings, groqApiKey: key });
      }
      await electronAPI.markOnboarded();
      settings.onboarded = true;
      onboarding.style.display = 'none';
      // Reflect the entered key in the Settings panel.
      if (key) inpKey.value = key;
    });
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function populateSettings() {
  inpKey.value      = settings.groqApiKey         || '';
  if (inpApiBase) inpApiBase.value = settings.apiBaseUrl || 'https://api.groq.com/openai/v1';
  inpLang.value     = settings.language ?? 'en';
  inpVocab.value    = settings.customVocabulary || '';
  togPP.checked     = settings.postProcessing     !== false;
  togInject.checked = settings.injectText         !== false;
  togTray.checked   = settings.startMinimized     !== false;
  togStartup.checked= settings.openAtLogin        === true;
  togNotify.checked = settings.notifyOnDone        !== false;
  inpTxTimeout.value  = Math.round((settings.transcriptionTimeoutMs || 30000) / 1000);
  inpLlmTimeout.value = Math.round((settings.llmTimeoutMs || 15000) / 1000);
  togSecure.checked      = settings.secureApiKey   === true;
  togVocabNotify.checked = settings.vocabularyNotify === true;
  togLive.checked        = settings.liveTranscription === true;
  if (togTone) togTone.checked = settings.toneAdaptation !== false;
  if (togEditMode) {
    togEditMode.checked = settings.editModeEnabled !== false;
  }
  if (togDevMode)    togDevMode.checked    = settings.developerMode  === true;
  if (togAutoLearn)  togAutoLearn.checked  = settings.autoLearnVocab === true;
  if (inpMacros) inpMacros.value = settings.voiceMacrosText || '';
  if (inpCustomPrompt) inpCustomPrompt.value = settings.customPrompt || '';
  if (inpApiBaseUrl) inpApiBaseUrl.value = settings.apiBaseUrl || '';
  if (inpTxApiUrl) inpTxApiUrl.value = settings.transcriptionApiUrl || '';
  setSel(inpHotkey,  settings.hotkey             || 'F9');
  setSel(inpHotkey2, settings.secondHotkey       || '');
  if (togPtt)    togPtt.checked = settings.pushToTalkEnabled === true;
  if (inpPttKey) setSel(inpPttKey, settings.pushToTalkKey || 'RightCtrl');
  setSel(inpTxModel, settings.transcriptionModel || 'whisper-large-v3');
  setSel(inpLlm,     settings.llmModel           || 'llama-3.3-70b-versatile');
  updateHotkeyDisplay(settings.hotkey || 'F9');

  // Disable secure-key toggle if the OS can't encrypt.
  electronAPI.secureStorageAvailable().then(ok => {
    if (!ok && togSecure) {
      togSecure.checked = false;
      togSecure.disabled = true;
      if (hintSecure) hintSecure.textContent = 'Secure storage unavailable on this system';
    }
  });

  // Disable push-to-talk if the native key-hook module isn't available.
  electronAPI.pttAvailable().then(ok => {
    if (!ok && togPtt) {
      togPtt.checked = false;
      togPtt.disabled = true;
      if (inpPttKey) inpPttKey.disabled = true;
      if (hintPtt) hintPtt.textContent = 'Push-to-talk unavailable (native module not loaded)';
    }
  });
}

function setSel(el, val) {
  if (el) el.value = val || '';
}

function updateHotkeyDisplay(hk) {
  const pretty = hk.replace('Control', 'Ctrl');
  hotkeyDisplay.textContent  = pretty;
  hotkeyDisplay2.textContent = pretty;
}

function setupSettingsUI() {
  btnToggleKey.addEventListener('click', () => {
    inpKey.type = inpKey.type === 'password' ? 'text' : 'password';
  });
  linkGroq.addEventListener('click', (e) => {
    e.preventDefault();
    electronAPI.openUrl('https://console.groq.com/keys');
  });
  btnSave.addEventListener('click', saveSettings);

  // Settings export / import
  const btnExportSettings = document.getElementById('btn-export-settings');
  const btnImportSettings = document.getElementById('btn-import-settings');
  const settingsIoMsg     = document.getElementById('settings-io-msg');

  function flashIoMsg(text, isError) {
    if (!settingsIoMsg) return;
    settingsIoMsg.textContent = text;
    settingsIoMsg.style.color = isError ? '#f87171' : '#6ee7b7';
    setTimeout(() => { settingsIoMsg.textContent = ''; }, 3000);
  }

  if (btnExportSettings) {
    btnExportSettings.addEventListener('click', async () => {
      const r = await electronAPI.exportSettings();
      flashIoMsg(r.ok ? `✓ Exported to ${r.filePath}` : `✗ ${r.error || 'Cancelled'}`, !r.ok);
    });
  }
  if (btnImportSettings) {
    btnImportSettings.addEventListener('click', async () => {
      const r = await electronAPI.importSettings();
      if (r.ok) {
        flashIoMsg('✓ Settings imported — reloading…', false);
      } else if (r.error) {
        flashIoMsg(`✗ ${r.error}`, true);
      }
    });
  }

  // When main process hot-reloads after import, refresh the UI
  electronAPI.onSettingsImported((imported) => {
    settings = imported;
    populateSettings();
    flashIoMsg('✓ Settings imported!', false);
  });

  if (btnTestApi) {
    btnTestApi.addEventListener('click', testApiConnection);
  }
}

async function saveSettings() {
  const s = {
    groqApiKey:         inpKey.value.trim(),
    apiBaseUrl:         inpApiBase ? inpApiBase.value.trim() : 'https://api.groq.com/openai/v1',
    language:           inpLang.value.trim(),
    customVocabulary:   inpVocab.value,
    postProcessing:     togPP.checked,
    injectText:         togInject.checked,
    startMinimized:     togTray.checked,
    openAtLogin:        togStartup.checked,
    notifyOnDone:       togNotify.checked,
    hotkey:             inpHotkey.value,
    secondHotkey:       inpHotkey2 ? inpHotkey2.value : '',
    pushToTalkEnabled:  togPtt ? togPtt.checked : false,
    pushToTalkKey:      inpPttKey ? inpPttKey.value : 'RightCtrl',
    transcriptionModel: inpTxModel.value,
    llmModel:           inpLlm.value,
    transcriptionTimeoutMs: Math.max(1, parseInt(inpTxTimeout.value, 10) || 30) * 1000,
    llmTimeoutMs:           Math.max(1, parseInt(inpLlmTimeout.value, 10) || 15) * 1000,
    secureApiKey:       togSecure ? togSecure.checked : false,
    vocabularyNotify:   togVocabNotify ? togVocabNotify.checked : false,
    liveTranscription:  togLive ? togLive.checked : false,
    toneAdaptation:     togTone ? togTone.checked : true,
    voiceMacrosText:    inpMacros ? inpMacros.value : '',
    editModeEnabled:    togEditMode ? togEditMode.checked : true,
    developerMode:      togDevMode ? togDevMode.checked : false,
    autoLearnVocab:     togAutoLearn ? togAutoLearn.checked : false,
    customPrompt:       inpCustomPrompt ? inpCustomPrompt.value.trim() : '',
    apiBaseUrl:         inpApiBaseUrl ? inpApiBaseUrl.value.trim() : '',
    transcriptionApiUrl: inpTxApiUrl ? inpTxApiUrl.value.trim() : '',
  };
  const r = await electronAPI.saveSettings(s);
  if (r?.ok) {
    settings = { ...settings, ...s, apiBaseUrl: r.apiBaseUrl || s.apiBaseUrl };
    if (inpApiBase) inpApiBase.value = settings.apiBaseUrl;
    updateHotkeyDisplay(s.hotkey);
    saveMsg.textContent = '✓ Saved!';
    setTimeout(() => { saveMsg.textContent = ''; }, 2500);
  } else {
    saveMsg.textContent = '✗ ' + (r?.error || 'Could not save settings');
    saveMsg.style.color = '#C0504D';
    setTimeout(() => { saveMsg.textContent = ''; saveMsg.style.color = ''; }, 5000);
  }
}

async function testApiConnection() {
  if (!testApiMsg) return;
  testApiMsg.textContent = 'Testing…';
  testApiMsg.style.color = '#6B6456';
  btnTestApi.disabled = true;

  try {
    const result = await electronAPI.testApi();
    if (result.ok) {
      testApiMsg.textContent = '✓ ' + result.message;
      testApiMsg.style.color = '#5C9B6B';
    } else {
      testApiMsg.textContent = '✗ ' + result.error;
      testApiMsg.style.color = '#C0504D';
    }
  } catch (e) {
    testApiMsg.textContent = '✗ Test failed: ' + e.message;
    testApiMsg.style.color = '#C0504D';
  }

  btnTestApi.disabled = false;
  setTimeout(() => { testApiMsg.textContent = ''; }, 6000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
init().catch(console.error);
