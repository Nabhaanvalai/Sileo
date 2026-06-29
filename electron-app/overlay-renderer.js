'use strict';
/* global overlayAPI */

const pill      = document.getElementById('pill');
const cancelBtn = document.getElementById('cancel-btn');

let mediaRecorder = null;
let audioChunks   = [];
let timerSec      = 0;
let timerInterval = null;
let isActive      = false;

// ─── Audio Analysis & Auto-stop ───────────────────────────────────────────────
let audioContext = null;
let analyser = null;
let microphone = null;
let dataArray = null;
let silenceTimer = null;
const SILENCE_THRESHOLD = 5; // Very low volume threshold (0-255)
const SILENCE_DURATION_MS = 1800; // 1.8 seconds of silence to auto-stop
let lastSpeechTime = 0;
let heardAnySound = false; // true once mic level crosses the threshold (mic-off detection)

// ─── Waveform ─────────────────────────────────────────────────────────────────
const bars = document.querySelectorAll('#bars span');
let animationId = null;

const MULTIPLIERS = [0.5, 0.75, 1.0, 0.75, 0.5];
const MIN_HEIGHT = 2;
const MAX_HEIGHT = 14;
let barLevels = [0, 0, 0, 0, 0]; // smoothed per-bar levels for the true waveform

// ─── Live (chunked) transcription ─────────────────────────────────────────────
let liveEnabled = false;
let liveTimer = null;
const LIVE_INTERVAL_MS = 2500; // how often to ship an interim snapshot

function animateWaveform() {
  if (!isActive || !analyser) return;

  analyser.getByteFrequencyData(dataArray);

  // Calculate average volume
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  const avgVolume = sum / dataArray.length;

  // Auto-stop logic
  const now = Date.now();
  if (avgVolume > SILENCE_THRESHOLD) {
    lastSpeechTime = now;
    heardAnySound = true;
  } else if (lastSpeechTime > 0 && (now - lastSpeechTime > SILENCE_DURATION_MS)) {
    console.log('[Overlay] Auto-stopping due to silence');
    stopRecording();
    return;
  }

  // True waveform: map each bar to a real frequency band and drive its height
  // from the actual mic energy in that band (with light smoothing so it doesn't
  // jitter). Replaces the previous synthetic sine-pulse animation.
  const bandCount = bars.length;
  const binsPerBand = Math.max(1, Math.floor(dataArray.length / bandCount));

  bars.forEach((b, index) => {
    let bandSum = 0;
    const start = index * binsPerBand;
    for (let i = start; i < start + binsPerBand && i < dataArray.length; i++) {
      bandSum += dataArray[i];
    }
    const bandAvg = bandSum / binsPerBand;          // 0–255
    // Slight per-bar shaping keeps the centre taller, like a classic meter.
    const target = Math.min((bandAvg / 180) * MULTIPLIERS[index] * 1.4, 1.0);

    // Exponential smoothing toward the live level.
    const prev = barLevels[index] || 0;
    const level = prev + (target - prev) * 0.5;
    barLevels[index] = level;

    const height = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * level;
    b.style.height = `${height}px`;
  });

  animationId = requestAnimationFrame(animateWaveform);
}

function stopBarAnimation() {
  if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
  barLevels = [0, 0, 0, 0, 0];
  bars.forEach(b => { b.style.height = '2px'; });
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  timerSec = 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerSec++;
    updateTimerDisplay();
    if (timerSec >= 119) stopRecording();
  }, 1000);
}

function updateTimerDisplay() {
  // Timer is handled under the hood now, UI is minimal.
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ─── ArrayBuffer → base64 ────────────────────────────────────────────────────
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Recording ────────────────────────────────────────────────────────────────
async function startRecording(opts) {
  console.log('[Overlay] Starting recording...');
  liveEnabled = !!(opts && opts.liveTranscription);
  try {
    // Mic-off detection: bail early if no audio input device is connected.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices.some(d => d.kind === 'audioinput')) {
        console.warn('[Overlay] No audio input device found');
        pill.className = 'pill error';
        overlayAPI.reportError('No microphone found');
        return;
      }
    } catch (_) { /* enumerateDevices unsupported — fall through to getUserMedia */ }

    heardAnySound = false;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true, // OS-level normalization
      }
    });

    // Setup Web Audio API for metering and silence detection
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    lastSpeechTime = Date.now(); // Initialize

    const mime = getSupportedMime();
    console.log('[Overlay] MIME type:', mime || 'browser default');

    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    audioChunks = [];
    isActive = true;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      console.log('[Overlay] Recorder stopped. Chunks:', audioChunks.length);
      isActive = false;
      stream.getTracks().forEach(t => t.stop());
      
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
      }

      if (audioChunks.length === 0) {
        console.log('[Overlay] No chunks');
        // Never captured any data and never heard sound → mic is likely off/muted.
        if (!heardAnySound) overlayAPI.reportError('Mic muted? No audio captured');
        else overlayAPI.cancel();
        return;
      }

      const mimeType = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: mimeType });
      console.log('[Overlay] Blob size:', blob.size, 'bytes, type:', mimeType);

      if (blob.size < 100) {
        console.log('[Overlay] Blob too small');
        if (!heardAnySound) overlayAPI.reportError('Mic muted? No audio captured');
        else overlayAPI.cancel();
        return;
      }

      // Convert to base64
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      console.log('[Overlay] Base64 length:', base64.length, '(from', arrayBuffer.byteLength, 'bytes)');

      overlayAPI.sendAudioBase64(base64, arrayBuffer.byteLength);
    };

    mediaRecorder.onerror = (e) => {
      console.error('[Overlay] Recorder error:', e);
      isActive = false;
      pill.className = 'pill error';
      overlayAPI.reportError('Recording error');
    };

    // Only emit periodic chunks when live transcription needs them. Without a
    // timeslice, MediaRecorder yields a single complete, valid container on
    // stop — which avoids the malformed-webm "could not process file" 400s that
    // periodic chunking can cause on longer recordings.
    if (liveEnabled) mediaRecorder.start(250);
    else mediaRecorder.start();
    setUIRecording();
    startTimer();
    animateWaveform();
    if (liveEnabled) startLiveFlush();
    console.log('[Overlay] Recording active');

  } catch (err) {
    console.error('[Overlay] Mic access error:', err);
    isActive = false;
    pill.className = 'pill error';
    // NotFound* → no device; otherwise treat as a permission problem.
    const noDevice = err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError');
    overlayAPI.reportError(noDevice
      ? 'No microphone found'
      : 'Mic access denied — check Windows Privacy settings');
  }
}

function stopRecording() {
  console.log('[Overlay] Stopping recording...');
  isActive = false;
  stopTimer();
  stopBarAnimation();
  stopLiveFlush();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); }
    catch (e) { console.error('[Overlay] Stop error:', e); }
  }
}

// Periodically ship the audio captured so far for an interim transcription.
// Groq has no realtime API, so this is a chunked approximation: each snapshot
// re-transcribes the full clip-to-date, giving the user live feedback.
function startLiveFlush() {
  stopLiveFlush();
  liveTimer = setInterval(async () => {
    if (!isActive || audioChunks.length === 0) return;
    try {
      const mimeType = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
      const blob = new Blob(audioChunks, { type: mimeType });
      if (blob.size < 2000) return; // too little to bother transcribing yet
      const arrayBuffer = await blob.arrayBuffer();
      overlayAPI.sendLiveChunk(arrayBufferToBase64(arrayBuffer));
    } catch (e) {
      console.warn('[Overlay] Live flush error:', e.message);
    }
  }, LIVE_INTERVAL_MS);
}

function stopLiveFlush() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

function getSupportedMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

// ─── UI states ────────────────────────────────────────────────────────────────
function setUIRecording() {
  pill.className = 'pill recording';
}

function setState({ recording, status }) {
  if (recording) { setUIRecording(); return; }

  isActive = false;
  stopTimer();
  stopBarAnimation();

  if (status && status.startsWith('Done')) {
    pill.className = 'pill done';
  } else if (status && (status.startsWith('⚠') || status.includes('detected'))) {
    pill.className = 'pill error';
  } else {
    pill.className = 'pill processing';
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
overlayAPI.onStartRecording(startRecording);
overlayAPI.onStopRecording(stopRecording);
overlayAPI.onRecordingState(setState);

cancelBtn.addEventListener('click', () => {
  isActive = false;
  stopTimer();
  stopBarAnimation();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    audioChunks = [];
    try { mediaRecorder.stop(); } catch (_) {}
  }
  overlayAPI.cancel();
});

console.log('[Overlay] Renderer loaded');
