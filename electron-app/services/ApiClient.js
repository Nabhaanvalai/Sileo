const http = require('http');
const https = require('https');

const DEFAULT_API_BASE_URL = 'https://api.groq.com/openai/v1';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function requiresApiKey(baseUrl) {
  try {
    return new URL(String(baseUrl || DEFAULT_API_BASE_URL)).hostname === 'api.groq.com';
  } catch (_) {
    return true;
  }
}

function isUsableApiKey(apiKey, baseUrl) {
  const key = String(apiKey || '').trim();
  if (requiresApiKey(baseUrl)) return /^gsk_[A-Za-z0-9_-]+$/.test(key);
  return key.length <= 4096 && !/[\r\n]/.test(key);
}

function resolveEndpoint(baseUrl, resource) {
  const rawBase = String(baseUrl || DEFAULT_API_BASE_URL).trim();
  const base = new URL(rawBase.endsWith('/') ? rawBase : `${rawBase}/`);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('API base URL must use http:// or https://');
  }
  return new URL(String(resource || '').replace(/^\/+/, ''), base);
}

function request(url, { method = 'POST', headers = {}, body = null, timeoutMs = 30000 } = {}) {
  const client = url.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));

  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let total = 0;

      res.on('data', (chunk) => {
        total += chunk.length;
        if (total <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      res.on('end', () => {
        if (total > MAX_RESPONSE_BYTES) {
          reject(new Error('API response was too large'));
          return;
        }
        resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('API request timed out'));
    });
    req.on('error', (error) => reject(error));
    if (payload) req.write(payload);
    req.end();
  });
}

async function requestJson(baseUrl, resource, payload, apiKey, timeoutMs) {
  const body = JSON.stringify(payload);
  return request(resolveEndpoint(baseUrl, resource), {
    method: 'POST',
    timeoutMs,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
}

async function requestMultipart(baseUrl, resource, body, boundary, apiKey, timeoutMs) {
  return request(resolveEndpoint(baseUrl, resource), {
    method: 'POST',
    timeoutMs,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
}

module.exports = {
  DEFAULT_API_BASE_URL,
  requiresApiKey,
  isUsableApiKey,
  resolveEndpoint,
  request,
  requestJson,
  requestMultipart,
};
