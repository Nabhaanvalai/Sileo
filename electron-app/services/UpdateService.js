'use strict';

const https = require('https');

// Sileo ships its releases from this GitHub repo (same as the Windows app).
const GITHUB_REPO = 'sileo-app/sileo';
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

/**
 * Parses a semantic version string ("v1.2.3" / "1.2.3") into [major, minor, patch].
 * Non-numeric / missing segments fall back to 0.
 */
function parseVersion(v) {
  if (!v) return [0, 0, 0];
  const cleaned = String(v).trim().replace(/^v/i, '');
  const parts = cleaned.split('.').map(n => parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Returns true if `latest` is a strictly newer semantic version than `current`.
 */
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/**
 * Queries the GitHub Releases API for the latest published release and
 * compares it against the running version.
 *
 * Resolves to:
 *   { updateAvailable, latestVersion, currentVersion, url, notes }
 * Never rejects — network/parse failures resolve with updateAvailable:false + error.
 */
function checkForUpdate(currentVersion) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      timeout: 8000,
      headers: {
        // GitHub requires a User-Agent on all API requests.
        'User-Agent': 'Sileo-Windows',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return resolve({
            updateAvailable: false,
            currentVersion,
            error: `GitHub API ${res.statusCode}`,
            url: RELEASES_PAGE,
          });
        }
        try {
          const json = JSON.parse(raw);
          const latestVersion = (json.tag_name || json.name || '').replace(/^v/i, '');
          resolve({
            updateAvailable: isNewer(latestVersion, currentVersion),
            latestVersion,
            currentVersion,
            url: json.html_url || RELEASES_PAGE,
            notes: (json.body || '').slice(0, 600),
          });
        } catch (e) {
          resolve({ updateAvailable: false, currentVersion, error: 'Invalid GitHub response', url: RELEASES_PAGE });
        }
      });
    });

    req.on('timeout', () => { req.destroy(); resolve({ updateAvailable: false, currentVersion, error: 'Update check timed out', url: RELEASES_PAGE }); });
    req.on('error', (e) => resolve({ updateAvailable: false, currentVersion, error: e.message, url: RELEASES_PAGE }));
    req.end();
  });
}

module.exports = {
  checkForUpdate,
  isNewer,
  parseVersion,
  RELEASES_PAGE,
};
