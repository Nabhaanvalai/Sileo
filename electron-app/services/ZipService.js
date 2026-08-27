'use strict';

/**
 * Minimal ZIP writer — STORE method only (no compression), which is a fully
 * valid zip and avoids pulling in a native/compiled dependency like `archiver`.
 *
 * Good enough for bundling a handful of small debug files (JSON, PNG, webm).
 */

// CRC-32 table (computed once at module load).
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

/**
 * Builds a zip Buffer from an array of { name, data } entries.
 * `data` may be a Buffer or a string (encoded as UTF-8).
 */
function createZip(entries) {
  const files = entries.map(e => ({
    name: e.name,
    data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8'),
  }));

  const localParts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header (signature 0x04034b50), STORE (method 0).
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method = store
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0, 12);          // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);       // compressed size
    local.writeUInt32LE(size, 22);       // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra len

    localParts.push(local, nameBuf, f.data);

    // Central directory header (signature 0x02014b50).
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0, 8);              // flags
    cd.writeUInt16LE(0, 10);            // method
    cd.writeUInt16LE(0, 12);            // mod time
    cd.writeUInt16LE(0, 14);            // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);           // extra len
    cd.writeUInt16LE(0, 32);           // comment len
    cd.writeUInt16LE(0, 34);           // disk number
    cd.writeUInt16LE(0, 36);           // internal attrs
    cd.writeUInt32LE(0, 38);           // external attrs
    cd.writeUInt32LE(offset, 42);      // local header offset

    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + f.data.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(central);

  // End of central directory record (signature 0x06054b50).
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

module.exports = { createZip, crc32 };
