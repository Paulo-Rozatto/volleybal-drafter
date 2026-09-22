import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const take = crc & 1;
      crc >>>= 1;
      if (take) crc ^= 0xedb88320;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function writePng(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y, size);
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paintMark(x, y, size) {
  const bg = [15, 118, 110];
  const fg = [255, 255, 255];
  const inset = size * 0.18;
  const radius = size * 0.22;
  const dx = Math.min(x, size - 1 - x);
  const dy = Math.min(y, size - 1 - y);
  if (dx < 1 || dy < 1) return bg;
  const inRound = dx < radius && dy < radius && (dx - radius) ** 2 + (dy - radius) ** 2 > radius ** 2;
  if (inRound) return [244, 241, 234];

  const bars = [
    { left: 0.22, bottom: 0.28, height: 0.28 },
    { left: 0.43, bottom: 0.28, height: 0.44 },
    { left: 0.64, bottom: 0.28, height: 0.56 },
  ];
  const barW = size * 0.14;
  for (const bar of bars) {
    const left = size * bar.left;
    const top = size - inset - size * bar.height;
    const bottom = size - inset;
    if (x >= left && x <= left + barW && y >= top && y <= bottom) return fg;
  }
  return bg;
}

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

export function padrePwaPlugin(base = '/volleybal-drafter/') {
  let outDir = 'dist';
  return {
    name: 'padre-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const iconsDir = join(outDir, 'icons');
      mkdirSync(iconsDir, { recursive: true });
      writeFileSync(join(iconsDir, 'icon-192.png'), writePng(192, paintMark));
      writeFileSync(join(iconsDir, 'icon-512.png'), writePng(512, paintMark));

      const manifest = {
        name: 'PaDre',
        short_name: 'PaDre',
        description: 'Cada jogo conta. Encontros, competições, rankings e estatísticas.',
        lang: 'pt-BR',
        dir: 'ltr',
        display: 'standalone',
        start_url: base,
        scope: base,
        id: base,
        theme_color: '#0f766e',
        background_color: '#f4f1ea',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      };
      writeFileSync(join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

      const files = walkFiles(outDir)
        .map((file) => relative(outDir, file).replace(/\\/g, '/'))
        .filter((file) => !file.endsWith('.map') && file !== 'sw.js');
      const precache = [base, ...files.map((file) => `${base}${file}`)];
      const sw = `const CACHE = 'padre-shell-v2';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname.includes('supabase.co') || url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/') || url.pathname.includes('/realtime/') || url.pathname.includes('/storage/v1/')) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('${base}index.html')));
    return;
  }
  if (url.pathname.includes('/assets/') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
  }
});
`;
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export function ensurePublicIcons(publicDir) {
  mkdirSync(join(publicDir, 'icons'), { recursive: true });
  writeFileSync(join(publicDir, 'icons', 'icon-192.png'), writePng(192, paintMark));
  writeFileSync(join(publicDir, 'icons', 'icon-512.png'), writePng(512, paintMark));
}

const invokedDirectly = process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/'));
if (invokedDirectly) {
  ensurePublicIcons(join(dirname(new URL(import.meta.url).pathname), '../public'));
}
