const https = require('https');

// llama-3.2-11b-vision-preview was decommissioned by Groq; Llama 4 Scout is the
// current multimodal model that accepts image input.
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/**
 * Sends a screenshot and context metadata to the Groq Vision model
 * to generate a 2-sentence summary of what the user is doing.
 */
function analyzeVisualContext(apiKey, base64Image, windowInfo) {
  return new Promise((resolve) => {
    if (!apiKey || !apiKey.startsWith('gsk_') || !base64Image) {
      return resolve(null);
    }

    const metadata = `Active App: ${windowInfo.processName || 'Unknown'}\nWindow Title: ${windowInfo.title || 'Unknown'}`;

    const payload = JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.2,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content: 'You are a context synthesis assistant for a speech-to-text pipeline. Analyze the screenshot and metadata to output exactly two sentences that describe what the user is doing right now and their likely writing intent. If details are missing, state uncertainty. Return only the two sentences.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Analyze the screenshot plus metadata to infer current activity.\n\n${metadata}` },
            { type: 'image_url', image_url: { url: base64Image } }
          ]
        }
      ]
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error('[VisionService] Groq API Error:', raw.slice(0, 150));
          return resolve(null);
        }
        try {
          const json = JSON.parse(raw);
          const summary = json.choices?.[0]?.message?.content?.trim();
          resolve(summary || null);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', (e) => {
      console.error('[VisionService] Network error:', e.message);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

module.exports = {
  analyzeVisualContext
};
