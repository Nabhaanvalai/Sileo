'use strict';

/**
 * Voice macros: a spoken trigger phrase expands to a predefined snippet.
 *
 * Macros are stored in settings as an array of { trigger, snippet } objects.
 * Matching is done on the normalised transcript (lowercased, trimmed, trailing
 * punctuation stripped) so "insert my email." and "Insert my email" both fire.
 */

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]+$/g, '')   // drop trailing punctuation Whisper adds
    .replace(/\s+/g, ' ');
}

/**
 * Parses macros from settings. Accepts either a structured array
 * (settings.voiceMacros) or a newline "trigger => snippet" text block
 * (settings.voiceMacrosText) for the simple textarea UI.
 */
function getMacros(settings) {
  if (Array.isArray(settings.voiceMacros) && settings.voiceMacros.length) {
    return settings.voiceMacros
      .filter(m => m && m.trigger && m.snippet)
      .map(m => ({ trigger: String(m.trigger), snippet: String(m.snippet) }));
  }

  const raw = settings.voiceMacrosText;
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split('\n')
      .map(line => {
        const idx = line.indexOf('=>');
        if (idx === -1) return null;
        const trigger = line.slice(0, idx).trim();
        const snippet = line.slice(idx + 2).trim();
        if (!trigger || !snippet) return null;
        return { trigger, snippet };
      })
      .filter(Boolean);
  }

  return [];
}

/**
 * Returns the matching macro's snippet for a transcript, or null if none match.
 * An exact (normalised) match wins; otherwise we accept a transcript that is
 * exactly the trigger phrase so we don't hijack normal dictation.
 */
function matchMacro(transcript, settings) {
  const macros = getMacros(settings);
  if (!macros.length) return null;

  const spoken = normalise(transcript);
  if (!spoken) return null;

  for (const m of macros) {
    if (normalise(m.trigger) === spoken) {
      return { trigger: m.trigger, snippet: m.snippet };
    }
  }
  return null;
}

module.exports = { getMacros, matchMacro, normalise };
