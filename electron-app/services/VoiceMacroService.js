'use strict';

/**
 * Voice macros: a spoken trigger phrase expands to a predefined snippet.
 *
 * Macros are stored in settings as an array of { trigger, snippet } objects.
 * Matching is done on the normalised transcript (lowercased, trimmed, trailing
 * punctuation stripped) so "insert my email." and "Insert my email" both fire.
 *
 * Match priority:
 *  1. Exact normalised match (full transcript == trigger)
 *  2. Transcript STARTS WITH the trigger (allows Whisper to prepend "Okay," etc.)
 *  3. Transcript ENDS WITH the trigger
 *  4. Transcript CONTAINS the trigger (only for triggers ≥ 3 words to avoid false positives)
 */

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    // Drop trailing punctuation Whisper commonly appends
    .replace(/[.,!?;:\u2026]+$/g, '')
    // Collapse internal whitespace
    .replace(/\s+/g, ' ')
    // Drop leading filler words Whisper sometimes prepends
    .replace(/^(okay|ok|hey|alright|so|well|um|uh)[,.]?\s+/i, '')
    .trim();
}

/**
 * Parses macros from settings. Accepts either a structured array
 * (settings.voiceMacros) or a newline "trigger => snippet" text block
 * (settings.voiceMacrosText) for the simple textarea UI.
 *
 * Multi-line snippets: use \n literally in the snippet, or use the
 * structured voiceMacros array for complex entries.
 */
function getMacros(settings) {
  if (Array.isArray(settings.voiceMacros) && settings.voiceMacros.length) {
    return settings.voiceMacros
      .filter(m => m && m.trigger && m.snippet)
      .map(m => ({ trigger: String(m.trigger).trim(), snippet: String(m.snippet) }));
  }

  const raw = settings.voiceMacrosText;
  if (typeof raw === 'string' && raw.trim()) {
    const macros = [];
    let i = 0;
    const lines = raw.split('\n');

    while (i < lines.length) {
      const line = lines[i];
      const arrowIdx = line.indexOf('=>');
      if (arrowIdx === -1) { i++; continue; }

      const trigger = line.slice(0, arrowIdx).trim();
      let snippet  = line.slice(arrowIdx + 2).trim();

      // Support multi-line snippets: subsequent lines that don't contain '=>'
      // are treated as continuation lines (joined with newline).
      while (i + 1 < lines.length && lines[i + 1].indexOf('=>') === -1 && lines[i + 1].trim() !== '') {
        i++;
        snippet += '\n' + lines[i];
      }

      if (trigger && snippet) {
        macros.push({ trigger, snippet });
      }
      i++;
    }
    return macros;
  }

  return [];
}

/**
 * Returns the matching macro for a transcript, or null if none match.
 *
 * Matching strategy (in priority order):
 *  1. Exact — normalised transcript equals normalised trigger
 *  2. Starts-with — transcript begins with the trigger (Whisper may prepend words)
 *  3. Ends-with   — transcript ends with the trigger
 *  4. Contains    — transcript contains the trigger (only for ≥3-word triggers)
 */
function matchMacro(transcript, settings) {
  const macros = getMacros(settings);
  if (!macros.length) return null;

  const spoken = normalise(transcript);
  if (!spoken) return null;

  console.log(`[VoiceMacro] Normalised spoken: "${spoken}"`);

  // Sort by trigger length descending so longer (more specific) triggers win first.
  const sorted = [...macros].sort((a, b) => b.trigger.length - a.trigger.length);

  for (const m of sorted) {
    const trig = normalise(m.trigger);
    if (!trig) continue;

    // 1. Exact match
    if (spoken === trig) {
      console.log(`[VoiceMacro] Exact match: "${trig}"`);
      return { trigger: m.trigger, snippet: m.snippet };
    }

    // 2. Transcript starts with trigger (e.g. "Okay, insert my email")
    if (spoken.startsWith(trig + ' ') || spoken.startsWith(trig + ',')) {
      console.log(`[VoiceMacro] Starts-with match: "${trig}"`);
      return { trigger: m.trigger, snippet: m.snippet };
    }

    // 3. Transcript ends with trigger
    if (spoken.endsWith(' ' + trig)) {
      console.log(`[VoiceMacro] Ends-with match: "${trig}"`);
      return { trigger: m.trigger, snippet: m.snippet };
    }

    // 4. Contains — only for multi-word triggers (≥3 words) to avoid noise
    const trigWords = trig.split(' ').length;
    if (trigWords >= 3 && spoken.includes(trig)) {
      console.log(`[VoiceMacro] Contains match: "${trig}"`);
      return { trigger: m.trigger, snippet: m.snippet };
    }
  }

  console.log(`[VoiceMacro] No match. Macros available: ${macros.map(m => normalise(m.trigger)).join(' | ')}`);
  return null;
}

module.exports = { getMacros, matchMacro, normalise };
