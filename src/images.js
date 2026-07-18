// Copyright 2026 Alexander L. Penny
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';

/* ------------------------------------------------------------------ *
 * Type detection.
 *
 * The browser-supplied Content-Type and filename are attacker-controlled,
 * so neither is trusted. The file's own leading bytes decide what it is,
 * and anything unrecognised is rejected.
 *
 * SVG is deliberately NOT accepted. An SVG is a script-capable document;
 * served from your own domain it could run JavaScript in your site's origin
 * and steal an admin session. Rasterise SVGs to PNG before uploading.
 * ------------------------------------------------------------------ */

const TYPES = [
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    size: pngSize,
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    size: jpegSize,
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => b.length > 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a'),
    size: gifSize,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
    size: webpSize,
  },
  {
    mime: 'image/avif',
    ext: 'avif',
    test: (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp'
      && ['avif', 'avis'].includes(b.subarray(8, 12).toString('latin1')),
    size: () => ({}),
  },
];

export function detectType(buffer) {
  return TYPES.find((t) => t.test(buffer)) || null;
}

export const ACCEPTED_MIMES = TYPES.map((t) => t.mime);

/* ------------------------------------------------------------------ *
 * Dimensions. Best-effort: a null width/height is cosmetic only.
 * ------------------------------------------------------------------ */

function pngSize(b) {
  if (b.length < 24) return {};
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10) return {};
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpegSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0-SOF15, excluding DHT(c4), JPGA(c8) and DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (len <= 0) return {};
    i += 2 + len;
  }
  return {};
}

function webpSize(b) {
  const fourcc = b.subarray(12, 16).toString('latin1');
  try {
    if (fourcc === 'VP8 ') {
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8X') {
      const w = b[24] | (b[25] << 8) | (b[26] << 16);
      const h = b[27] | (b[28] << 8) | (b[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
  } catch { /* fall through */ }
  return {};
}

/* ------------------------------------------------------------------ *
 * Public IDs.
 *
 * Unambiguous alphabet: no 0/O or 1/l/I, so an ID read aloud or copied
 * by hand does not turn into a different image.
 * ------------------------------------------------------------------ */

const ALPHABET = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateId(length = config.idLength) {
  const out = [];
  // Rejection sampling keeps the distribution uniform across the alphabet.
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export function generateUniqueId() {
  for (let i = 0; i < 12; i += 1) {
    const id = generateId();
    if (!q.imageById.get(id)) return id;
  }
  throw new Error('Could not allocate a free image ID.');
}

export const ID_PATTERN = new RegExp(`^[${ALPHABET}]{4,32}$`);

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
