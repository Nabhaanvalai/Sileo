'use strict';

/**
 * Secure credential storage for the Groq API key.
 *
 * Instead of a third-party native module (keytar), we use Electron's built-in
 * `safeStorage`, which on Windows encrypts with DPAPI scoped to the OS user.
 * The encrypted key is written to `credentials.bin` in userData; the plaintext
 * key is never persisted to `settings.json`.
 *
 * Falls back to returning null (caller keeps using plaintext settings) if the
 * platform reports encryption as unavailable.
 */

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const FILE_NAME = 'credentials.bin';

function filePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function isAvailable() {
  try { return safeStorage.isEncryptionAvailable(); }
  catch (_) { return false; }
}

/**
 * Encrypts and persists the API key. Returns true on success.
 * Passing an empty value deletes the stored credential.
 */
function saveApiKey(key) {
  try {
    if (!key) { clear(); return true; }
    if (!isAvailable()) return false;
    const encrypted = safeStorage.encryptString(String(key));
    fs.writeFileSync(filePath(), encrypted);
    return true;
  } catch (e) {
    console.error('[CredentialService] save error:', e.message);
    return false;
  }
}

/**
 * Reads and decrypts the stored API key, or null if none / unavailable.
 */
function loadApiKey() {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return null;
    if (!isAvailable()) return null;
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  } catch (e) {
    console.error('[CredentialService] load error:', e.message);
    return null;
  }
}

function clear() {
  try { if (fs.existsSync(filePath())) fs.unlinkSync(filePath()); }
  catch (_) {}
}

module.exports = { isAvailable, saveApiKey, loadApiKey, clear };
