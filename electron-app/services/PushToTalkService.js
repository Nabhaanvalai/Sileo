'use strict';

/**
 * True push-to-talk (hold-to-talk) via global low-level keyboard hooks.
 *
 * Electron's `globalShortcut` only fires on key *press* (no key-up), so it can
 * only toggle. uiohook-napi gives us real keydown/keyup events, letting us
 * record while a key is held and stop the instant it's released.
 *
 * We load uiohook lazily and defensively — if the native module fails to load
 * (e.g. ABI mismatch on some setups), push-to-talk simply stays disabled and
 * the rest of the app is unaffected.
 */

let uIOhook = null;
let UiohookKey = null;
let loadError = null;

try {
  const mod = require('uiohook-napi');
  uIOhook = mod.uIOhook;
  UiohookKey = mod.UiohookKey;
} catch (e) {
  loadError = e.message;
  console.error('[PushToTalk] uiohook-napi failed to load:', e.message);
}

let started = false;     // whether the global hook is running
let activeKeycode = null; // the keycode we're currently watching, or null
let keyHeld = false;     // guards against keydown auto-repeat
let onDown = null;
let onUp = null;

/**
 * Maps a friendly hotkey label (the value stored in settings) to a uiohook
 * keycode. Supports the same options offered in the Settings dropdown.
 */
function labelToKeycode(label) {
  if (!UiohookKey || !label) return null;
  const map = {
    'F1': UiohookKey.F1, 'F2': UiohookKey.F2, 'F3': UiohookKey.F3,
    'F4': UiohookKey.F4, 'F5': UiohookKey.F5, 'F6': UiohookKey.F6,
    'F7': UiohookKey.F7, 'F8': UiohookKey.F8, 'F9': UiohookKey.F9,
    'F10': UiohookKey.F10, 'F11': UiohookKey.F11, 'F12': UiohookKey.F12,
    'RightCtrl': UiohookKey.CtrlRight,
    'RightAlt': UiohookKey.AltRight,
    'RightShift': UiohookKey.ShiftRight,
    'CapsLock': UiohookKey.CapsLock,
  };
  return map[label] != null ? map[label] : null;
}

function isAvailable() {
  return !!uIOhook && !loadError;
}

/**
 * Enables push-to-talk for `keyLabel`, invoking onStart() when the key goes
 * down and onStop() when it's released. Re-calling with a new key reconfigures
 * the watched key. Pass a falsy keyLabel to disable.
 */
function enable(keyLabel, onStart, onStop) {
  if (!isAvailable()) return false;

  const keycode = labelToKeycode(keyLabel);
  if (!keycode) { disable(); return false; }

  activeKeycode = keycode;
  keyHeld = false;

  // Register listeners once; they read the current activeKeycode each event.
  if (!onDown) {
    onDown = (e) => {
      if (e.keycode !== activeKeycode || keyHeld) return; // ignore other keys + auto-repeat
      keyHeld = true;
      try { onStart && onStart(); } catch (err) { console.error('[PushToTalk] onStart error:', err.message); }
    };
    onUp = (e) => {
      if (e.keycode !== activeKeycode || !keyHeld) return;
      keyHeld = false;
      try { onStop && onStop(); } catch (err) { console.error('[PushToTalk] onStop error:', err.message); }
    };
    uIOhook.on('keydown', onDown);
    uIOhook.on('keyup', onUp);
  }

  if (!started) {
    try {
      uIOhook.start();
      started = true;
      console.log('[PushToTalk] hook started for key', keyLabel);
    } catch (e) {
      console.error('[PushToTalk] start error:', e.message);
      return false;
    }
  }
  return true;
}

/**
 * Disables push-to-talk and stops the global hook. Safe to call repeatedly.
 */
function disable() {
  activeKeycode = null;
  keyHeld = false;
  if (started && uIOhook) {
    try { uIOhook.stop(); } catch (e) { console.error('[PushToTalk] stop error:', e.message); }
    started = false;
  }
}

module.exports = { isAvailable, enable, disable, labelToKeycode };
