const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const VoiceMacroService = require('../services/VoiceMacroService');
const VocabularyService = require('../services/VocabularyService');
const PostProcessingService = require('../services/PostProcessingService');
const ZipService = require('../services/ZipService');
const ApiClient = require('../services/ApiClient');

function loadHistoryService(userDataPath) {
  const historyPath = require.resolve('../services/HistoryService');
  delete require.cache[historyPath];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userDataPath } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../services/HistoryService');
  } finally {
    Module._load = originalLoad;
  }
}

test('voice macros normalize punctuation and match exact spoken triggers', () => {
  const settings = { voiceMacrosText: 'insert my email => alex@example.com\nnew line =>\n' };

  assert.equal(VoiceMacroService.normalise('  Insert my email!!! '), 'insert my email');
  assert.deepEqual(VoiceMacroService.getMacros(settings), [
    { trigger: 'insert my email', snippet: 'alex@example.com' },
  ]);
  assert.deepEqual(
    VoiceMacroService.matchMacro('Insert my email.', settings),
    { trigger: 'insert my email', snippet: 'alex@example.com' },
  );
  assert.deepEqual(
    VoiceMacroService.matchMacro('insert my email please', settings),
    { trigger: 'insert my email', snippet: 'alex@example.com' },
  );
});

test('vocabulary matching is case-insensitive and whole-word aware', () => {
  const settings = { customVocabulary: 'Sileo, API key\nGroq' };

  assert.deepEqual(VocabularyService.parseVocabulary(settings), ['Sileo', 'API key', 'Groq']);
  assert.deepEqual(
    VocabularyService.matchedTerms('I configured the SILEO API key for Groq.', settings),
    ['Sileo', 'API key', 'Groq'],
  );
  assert.deepEqual(VocabularyService.matchedTerms('The sileoapp is different.', settings), []);
});

test('hallucination filtering rejects common silence output but keeps real speech', () => {
  assert.equal(PostProcessingService.isHallucination('Thank you.'), true);
  assert.equal(PostProcessingService.isHallucination('Please send the report.'), false);
  assert.equal(PostProcessingService.isHallucination('   '), true);
});

test('prompt preview handles missing window context and legacy vocabulary settings', () => {
  const prompt = PostProcessingService.previewPrompt(
    'send the report',
    { vocabulary: 'Sileo', toneAdaptation: true },
    { selectedText: '', visionSummary: '', window: undefined },
  );

  assert.match(prompt, /Custom Vocabulary/);
  assert.match(prompt, /Sileo/);
  assert.doesNotMatch(prompt, /Active App: undefined/);
});

test('edit mode can be disabled and developer mode preserves code identifiers', () => {
  const normalPrompt = PostProcessingService.previewPrompt(
    'replace this',
    { editModeEnabled: false, toneAdaptation: true },
    { selectedText: 'original text', window: { processName: 'Code', title: 'VS Code' } },
  );
  assert.match(normalPrompt, /RAW: replace this/);
  assert.doesNotMatch(normalPrompt, /Instruction: replace this/);

  const developerPrompt = PostProcessingService.previewPrompt(
    'use my_variable',
    { developerMode: true },
    null,
  );
  assert.match(developerPrompt, /Developer mode/);
  assert.match(developerPrompt, /camelCase/);
});

test('history service persists, orders, and clears records', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sileo-history-'));
  try {
    const history = loadHistoryService(userDataPath);
    history.addEntry({ rawText: 'first', finalText: 'First' });
    history.addEntry({ rawText: 'second', finalText: 'Second' });

    assert.equal(history.getHistory().length, 2);
    assert.deepEqual(history.getHistory()[0].finalText, 'Second');
    assert.equal(history.clearHistory().ok, true);
    assert.deepEqual(history.getHistory(), []);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('provider validation supports Groq and unauthenticated local endpoints', () => {
  assert.equal(ApiClient.requiresApiKey('https://api.groq.com/openai/v1'), true);
  assert.equal(ApiClient.isUsableApiKey('gsk_valid_key-1', 'https://api.groq.com/openai/v1'), true);
  assert.equal(ApiClient.isUsableApiKey('not-a-groq-key', 'https://api.groq.com/openai/v1'), false);
  assert.equal(ApiClient.requiresApiKey('http://127.0.0.1:11434/v1'), false);
  assert.equal(ApiClient.isUsableApiKey('', 'http://127.0.0.1:11434/v1'), true);
  assert.equal(ApiClient.resolveEndpoint('https://api.groq.com/openai/v1', 'chat/completions').pathname, '/openai/v1/chat/completions');
});

test('API client sends JSON to an HTTP-compatible local provider', async () => {
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, undefined);
      assert.deepEqual(JSON.parse(body), { model: 'local-model' });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const result = await ApiClient.requestJson(
      `http://127.0.0.1:${address.port}/v1`,
      'chat/completions',
      { model: 'local-model' },
      '',
      2000,
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('ZIP export creates a valid empty-entry archive signature', () => {
  const zip = ZipService.createZip([]);
  assert.equal(zip.readUInt32LE(0), 0x06054b50);
});
