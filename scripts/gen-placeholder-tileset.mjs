// Generates levels/tilesets/placeholder.png + placeholder.tsj.
// Throwaway art: replace the PNG with real pixel art of the same layout
// (16×16 tiles, 5 columns) and every level picks it up automatically.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const TILE = 16;
const COLS = 5;

// [name, surface, base colour, speckle colours]
const TILES = [
  ['grass', 'grass', '#4f7a2e', ['#466e28', '#5a8634']],
  ['grass-stripe', 'grass', '#5a8a34', ['#527f2f', '#64953b']],
  ['driveway', 'pavement', '#8f897d', ['#847e72', '#9a9488']],
  ['sidewalk', 'pavement', '#b3ab9c', ['#a69e8f']],
  ['street', 'pavement', '#3e3d3f', ['#353436', '#48474a']],
  ['curb', 'pavement', '#3e3d3f', ['#353436']],
  ['mulch', 'mulch', '#5a3a24', ['#4a2e1c', '#6b4630']],
  ['gravel', 'gravel', '#8d8576', ['#a39b8b', '#776f61', '#6a6356']],
  ['flowerbed', 'mulch', '#5a3a24', ['#4a2e1c']],
  ['patio', 'pavement', '#9c7656', ['#8a6648']],
];

const rows = Math.ceil(TILES.length / COLS);
const W = COLS * TILE;
const H = rows * TILE;
const px = new Uint8Array(W * H * 4);

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function set(x, y, colour) {
  const [r, g, b] = hex(colour);
  const i = (y * W + x) * 4;
  px.set([r, g, b, 255], i);
}

TILES.forEach(([name, , base, speckles], t) => {
  const ox = (t % COLS) * TILE;
  const oy = Math.floor(t / COLS) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let c = base;
      if (rand() < 0.22) c = speckles[Math.floor(rand() * speckles.length)];
      if (name === 'sidewalk' && (x === 0 || y === 0)) c = '#958d7e';
      if (name === 'curb' && y < 3) c = y === 2 ? '#8a8478' : '#c9c2b5';
      if (name === 'patio' && (x % 8 === 0 || y % 8 === 0)) c = '#7a5a40';
      set(ox + x, oy + y, c);
    }
  }
  if (name === 'flowerbed') {
    for (const [fx, fy, c] of [[3, 3, '#e86aa0'], [11, 5, '#f2c84b'], [6, 11, '#e86aa0'], [13, 12, '#f2f2f2'], [2, 13, '#f2c84b']]) {
      set(ox + fx, oy + fy, c);
      set(ox + fx + 1, oy + fy, '#3f6b2a');
    }
  }
});

// --- Minimal PNG encoder ---
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../levels/tilesets/placeholder.png', import.meta.url), png);

const tsj = {
  type: 'tileset',
  version: '1.10',
  tiledversion: '1.11.2',
  name: 'placeholder',
  tilewidth: TILE,
  tileheight: TILE,
  tilecount: TILES.length,
  columns: COLS,
  image: 'placeholder.png',
  imagewidth: W,
  imageheight: H,
  margin: 0,
  spacing: 0,
  tiles: TILES.map(([name, surface], id) => ({
    id,
    properties: [
      { name: 'label', type: 'string', value: name },
      { name: 'surface', type: 'string', value: surface },
    ],
  })),
};
writeFileSync(new URL('../levels/tilesets/placeholder.tsj', import.meta.url), JSON.stringify(tsj, null, 1) + '\n');
console.log(`Wrote placeholder tileset: ${TILES.length} tiles, ${W}×${H}px`);
