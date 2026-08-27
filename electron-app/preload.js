const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings:    ()  => ipcRenderer.invoke('get-settings'),
  saveSettings:   (s) => ipcRenderer.invoke('save-settings', s),
  copyText:       (t) => ipcRenderer.invoke('copy-text', t),
  openUrl:        (u) => ipcRenderer.invoke('open-url', u),
  minimize:       ()  => ipcRenderer.invoke('win-minimize'),
  maximize:       ()  => ipcRenderer.invoke('win-maximize'),
  close:          ()  => ipcRenderer.invoke('win-close'),
  testApi:        ()  => ipcRenderer.invoke('test-api'),
  getHistory:     ()  => ipcRenderer.invoke('get-history'),
  clearHistory:   ()  => ipcRenderer.invoke('clear-history'),
  exportHistory:  ()  => ipcRenderer.invoke('export-history'),
  exportTestCase: ()  => ipcRenderer.invoke('export-test-case'),
  secureStorageAvailable: () => ipcRenderer.invoke('secure-storage-available'),
  pttAvailable:   ()  => ipcRenderer.invoke('ptt-available'),
  markOnboarded:  ()  => ipcRenderer.invoke('mark-onboarded'),
  // Settings backup / restore
  exportSettings: ()  => ipcRenderer.invoke('export-settings'),
  importSettings: ()  => ipcRenderer.invoke('import-settings'),
  // Events
  onNewTranscript: (cb) => ipcRenderer.on('new-transcript',    (_, t) => cb(t)),
  onPipelineDebug: (cb) => ipcRenderer.on('pipeline-debug',    (_, d) => cb(d)),
  onLiveTranscript:(cb) => ipcRenderer.on('live-transcript',   (_, t) => cb(t)),
  onSettingsImported:(cb)=> ipcRenderer.on('settings-imported', (_, s) => cb(s)),
});
