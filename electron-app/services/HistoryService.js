const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let historyFilePath = '';

/**
 * Initializes the history service
 */
function init() {
  const userDataPath = app.getPath('userData');
  historyFilePath = path.join(userDataPath, 'history.jsonl');
}

/**
 * Appends a new transcription record to the history
 */
function addEntry(record) {
  if (!historyFilePath) init();
  
  const entry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    ...record
  };
  
  try {
    fs.appendFileSync(historyFilePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[HistoryService] Failed to write history:', e.message);
  }
  
  return entry;
}

/**
 * Reads the history and returns it in reverse chronological order (newest first).
 */
function getHistory(limit = 100) {
  if (!historyFilePath) init();
  if (!fs.existsSync(historyFilePath)) return [];

  try {
    const data = fs.readFileSync(historyFilePath, 'utf8');
    const lines = data.split('\n').filter(line => line.trim() !== '');
    
    const records = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Sort newest first
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return records.slice(0, limit);
  } catch (e) {
    console.error('[HistoryService] Failed to read history:', e.message);
    return [];
  }
}

/**
 * Exports history to a Markdown file
 */
function exportToMarkdown(exportPath) {
  const records = getHistory(1000); // Export up to 1000 recent
  let md = '# Sileo Transcription History\n\n';
  
  records.forEach(r => {
    md += `## ${new Date(r.timestamp).toLocaleString()}\n`;
    if (r.context && r.context.window?.title) {
      md += `**Context:** ${r.context.window.processName} - ${r.context.window.title}\n`;
    }
    md += `**Raw (Whisper):** ${r.rawText}\n\n`;
    md += `**Final (Cleaned):** ${r.finalText}\n\n`;
    md += `---\n\n`;
  });
  
  fs.writeFileSync(exportPath, md, 'utf8');
}

module.exports = {
  init,
  addEntry,
  getHistory,
  exportToMarkdown
};
