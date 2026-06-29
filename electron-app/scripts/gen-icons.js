'use strict';

/**
 * Generates app icons from the source logo into electron-app/build/ and assets/.
 *
 *   - build/icon.ico   → Windows app + installer icon (multi-size)
 *   - build/icon.png   → 512px master PNG (electron-builder fallback)
 *   - assets/icon-256.png, icon-32.png, icon-16.png → window + tray icons
 *
 * Run:  npm run icons
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// png-to-ico is published as an ESM-interop module; the callable is on .default.
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, '..', 'Resources', 'Sileo logo.png');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSETS_DIR = path.join(ROOT, 'assets');

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('[icons] Source logo not found:', SOURCE);
    process.exit(1);
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // Resize helper that keeps the square logo and outputs a PNG buffer.
  const resize = (size) =>
    sharp(SOURCE).resize(size, size, { fit: 'cover' }).png().toBuffer();

  // PNG masters
  const png512 = await resize(512);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png512);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon-256.png'), await resize(256));
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon-32.png'), await resize(32));
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon-16.png'), await resize(16));

  // Multi-size .ico for Windows (16–256). png-to-ico accepts an array of PNG buffers.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(icoSizes.map(resize));
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico);

  console.log('[icons] Wrote:');
  console.log('  build/icon.ico  (' + icoSizes.join(',') + ')');
  console.log('  build/icon.png  (512)');
  console.log('  assets/icon-256.png, icon-32.png, icon-16.png');
}

main().catch((e) => {
  console.error('[icons] Failed:', e.message);
  process.exit(1);
});
