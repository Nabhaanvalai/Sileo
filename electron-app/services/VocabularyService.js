'use strict';

/**
 * Helpers around the user's custom vocabulary list.
 *
 * The vocabulary is a comma/newline separated list of terms the user wants
 * spelled exactly (e.g. product names). We use it both to inform the LLM
 * (handled in PostProcessingService) and to detect when those terms actually
 * landed in the final text so the UI can surface a toast.
 */

function parseVocabulary(settings) {
  const raw = settings.customVocabulary || settings.vocabulary || '';
  return String(raw)
    .split(/[,\n]/)
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * Returns the list of vocabulary terms that appear (case-insensitively, as
 * whole words) in the final text. Used to drive "vocabulary applied" toasts.
 */
function matchedTerms(finalText, settings) {
  const terms = parseVocabulary(settings);
  if (!terms.length || !finalText) return [];

  const hay = String(finalText);
  const hits = [];
  for (const term of terms) {
    // Whole-word, case-insensitive. Escape regex metachars in the term.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
    if (re.test(hay)) hits.push(term);
  }
  return hits;
}

module.exports = { parseVocabulary, matchedTerms };
