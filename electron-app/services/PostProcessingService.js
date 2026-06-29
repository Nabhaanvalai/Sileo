const https = require('https');

// Common Whisper hallucinations during silence
const HALLUCINATIONS = [
  'thank you.',
  'thank you',
  'thank you for watching.',
  'thanks for watching.',
  'please subscribe.',
  'subscribe to my channel.',
  'bye.',
  'amara.org',
  'you'
];

/**
 * Detects common Whisper AI hallucinations
 */
function isHallucination(transcript) {
  if (!transcript || !transcript.trim()) return true;
  const cleaned = transcript.trim().toLowerCase();
  return HALLUCINATIONS.includes(cleaned);
}

/**
 * Formats the context block for the LLM
 */
function buildContextBlock(contextInfo) {
  if (!contextInfo || (!contextInfo.window.title && !contextInfo.selectedText && !contextInfo.visionSummary)) {
    return '';
  }

  let block = `\n\n[CONTEXT]\nActive App: ${contextInfo.window?.processName || 'Unknown'}\nWindow Title: ${contextInfo.window?.title || 'Unknown'}`;
  
  if (contextInfo.selectedText) {
    block += `\nSelected Text: "${contextInfo.selectedText}"`;
  }
  
  if (contextInfo.visionSummary) {
    block += `\nScreen AI Summary: ${contextInfo.visionSummary}`;
  }
  
  return block;
}

// Maps the active app/window to a tone hint, the way Wispr Flow silently makes
// Slack casual and Gmail formal. Matching is on the lowercased process name +
// window title so it works across browsers (e.g. Gmail in Chrome) and native apps.
const TONE_RULES = [
  { match: /slack|discord|whatsapp|telegram|messenger|signal|teams/, tone: 'casual, conversational chat message — contractions are fine, keep it short, no greeting/sign-off' },
  { match: /gmail|outlook|mail|proton ?mail|yahoo mail/,            tone: 'professional email — clear, polite, well-punctuated; no slang' },
  { match: /word|google docs|docs\.google|notion|obsidian|confluence/, tone: 'clean written prose suitable for a document' },
  { match: /jira|linear|asana|trello|github|gitlab|bitbucket/,      tone: 'concise, direct issue/ticket or technical note' },
  { match: /code|vscode|visual studio|cursor|sublime|jetbrains|intellij|pycharm|terminal|powershell|cmd/, tone: 'terse and technical; preserve code, identifiers, and commands verbatim' },
  { match: /twitter|x\.com|linkedin|facebook|instagram|reddit/,     tone: 'punchy social-post style; natural and engaging' },
];

/**
 * Returns a one-line tone instruction for the active app, or '' if no rule
 * matches (or the feature is disabled).
 */
function buildToneInstruction(settings, contextInfo) {
  if (settings.toneAdaptation === false) return '';
  const haystack = `${contextInfo?.window?.processName || ''} ${contextInfo?.window?.title || ''}`.toLowerCase();
  if (!haystack.trim()) return '';
  const rule = TONE_RULES.find(r => r.match.test(haystack));
  return rule ? `\n- Adapt the tone and formality to fit the destination app: ${rule.tone}.` : '';
}

/**
 * Builds the appropriate system prompt based on settings and whether we are in Edit Mode
 */
function buildSystemPrompt(settings, contextInfo) {
  const customPrompt = settings.customPrompt ? `\nUser Custom Rules: ${settings.customPrompt}` : '';
  const vocab = settings.customVocabulary ? `\nCustom Vocabulary (ensure correct spelling): ${settings.customVocabulary}` : '';
  const tone = buildToneInstruction(settings, contextInfo);
  const contextBlock = buildContextBlock(contextInfo);

  // Edit Mode: If there's selected text, we assume the user is giving an instruction to modify it
  if (contextInfo?.selectedText) {
    return `You are a text editing assistant.
The user has highlighted the "Selected Text" and has spoken an instruction to modify it.
Apply the user's spoken instruction to the "Selected Text".
Return ONLY the final modified text. No explanations, no markdown formatting.
If the instruction is unclear, just return the original text.${customPrompt}${vocab}${contextBlock}`;
  }

  // Normal Dictation Mode
  return `You are a dictation cleanup layer.
Hard rules:
- Return ONLY the cleaned text, nothing else.
- No markdown, no explanations, no added content.
- Remove filler words (um, uh, like, you know) and false starts.
- Fix punctuation, capitalisation, and obvious speech-recognition errors.
- Apply spoken self-corrections / backtracking (e.g. "Tuesday, wait, Wednesday" → "Wednesday").
- Preserve the speaker's meaning and language exactly.${tone}
- If the input is empty or only filler, return exactly: EMPTY${customPrompt}${vocab}${contextBlock}`;
}

/**
 * Calls the Groq LLM to post-process the transcript
 */
function processTranscript(transcript, settings, contextInfo = null) {
  return new Promise((resolve, reject) => {
    // 1. Hallucination Filtering
    if (isHallucination(transcript)) {
      console.log('[PostProcessing] Hallucination filtered out:', transcript);
      return resolve('');
    }

    const apiKey = settings.groqApiKey;
    const model = settings.llmModel || 'llama-3.3-70b-versatile';

    const systemPrompt = buildSystemPrompt(settings, contextInfo);
    
    // In edit mode, the user's voice is the instruction, and the selected text is the target
    const userMessage = contextInfo?.selectedText 
      ? `Instruction: ${transcript}` 
      : `RAW: ${transcript}`;

    const payload = JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      timeout: settings.llmTimeoutMs || 15000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`LLM ${res.statusCode}: ${raw.slice(0, 150)}`));
          return;
        }
        try {
          let t = JSON.parse(raw).choices?.[0]?.message?.content?.trim() || '';
          if (t === 'EMPTY') t = '';
          resolve(t || transcript);
        } catch (_) {
          reject(new Error('Invalid LLM response'));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('LLM timed out')); });
    req.on('error', (e) => reject(new Error('Network: ' + e.message)));
    req.write(payload);
    req.end();
  });
}

/**
 * Returns the exact system + user prompt that would be sent to the LLM for a
 * given transcript, without making any network call. Powers the Pipeline
 * debug view in the dashboard.
 */
function previewPrompt(transcript, settings, contextInfo = null) {
  const systemPrompt = buildSystemPrompt(settings, contextInfo);
  const userMessage = contextInfo?.selectedText
    ? `Instruction: ${transcript}`
    : `RAW: ${transcript}`;
  return `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userMessage}`;
}

module.exports = {
  processTranscript,
  isHallucination,
  previewPrompt
};
