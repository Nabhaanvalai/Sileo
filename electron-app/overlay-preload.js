const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onStartRecording:  (cb) => ipcRenderer.on('start-recording',  (_, opts) => cb(opts || {})),
  onStopRecording:   (cb) => ipcRenderer.on('stop-recording',   () => cb()),
  onRecordingState:  (cb) => ipcRenderer.on('recording-state',  (_, d) => cb(d)),
  cancel:            ()   => ipcRenderer.send('overlay-cancel'),
  reportError:       (msg) => ipcRenderer.send('overlay-error', msg),

  // Send audio as base64 string — survives IPC serialization correctly
  sendAudioBase64: (base64String) => {
    console.log(`[Preload] Sending base64 audio, string length: ${base64String.length}`);
    ipcRenderer.send('audio-base64-ready', base64String);
  },

  // Live (chunked) transcription: send an interim accumulated audio snapshot.
  sendLiveChunk: (base64String) => ipcRenderer.send('audio-live-chunk', base64String),
});
