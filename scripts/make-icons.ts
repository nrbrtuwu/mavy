// Generates the monochrome app icons in web/public/icons/ (no image tools needed).
//   bun run icons
//
// The icon is a simple train front made of rectangles and circles on a black
// square. Everything stays inside the maskable safe zone (circle of radius 40
// around the center, in a 100x100 design space), so one image works as both a
// normal and a maskable icon. PNGs are 8-bit greyscale.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Shape =
  | { kind: 'rect'; x1: number; y1: number; x2: number; y2: number; grey: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; grey: number };

const BLACK = 0x00;
const WHITE = 0xff;

// Painted in order; later shapes cover earlier ones.
const SHAPES: Shape[] = [
  { kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 100, grey: BLACK }, // background
  { kind: 'rect', x1: 30, y1: 22, x2: 70, y2: 72, grey: WHITE }, // body
  { kind: 'rect', x1: 35, y1: 28, x2: 65, y2: 47, grey: BLACK }, // windscreen
  { kind: 'circle', cx: 38.5, cy: 60, r: 3.5, grey: BLACK }, // headlights
  { kind: 'circle', cx: 61.5, cy: 60, r: 3.5, grey: BLACK },
  { kind: 'rect', x1: 33, y1: 72, x2: 40, y2: 78, grey: WHITE }, // bogies
  { kind: 'rect', x1: 60, y1: 72, x2: 67, y2: 78, grey: WHITE },
  { kind: 'rect', x1: 27, y1: 80, x2: 73, y2: 82.5, grey: WHITE }, // rail
];

function greyAt(x: number, y: number): number {
  let grey = BLACK;
  for (const s of SHAPES) {
    const inside =
      s.kind === 'rect'
        ? x >= s.x1 && x < s.x2 && y >= s.y1 && y < s.y2
        : (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r ** 2;
    if (inside) grey = s.grey;
  }
  return grey;
}

/** Rasterize with 4x4 supersampling for smooth edges. */
function render(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size);
  const n = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sum = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          sum += greyAt(((px + (sx + 0.5) / n) / size) * 100, ((py + (sy + 0.5) / n) / size) * 100);
        }
      }
      pixels[py * size + px] = Math.round(sum / (n * n));
    }
  }
  return pixels;
}

// ---------------------------------------------------------------- minimal PNG encoder (greyscale)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(size: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type 0 = greyscale
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * size, (y + 1) * size), y * (size + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

function svg(): string {
  const hex = (g: number) => `#${g.toString(16).padStart(2, '0').repeat(3)}`;
  const body = SHAPES.map((s) =>
    s.kind === 'rect'
      ? `<rect x="${s.x1}" y="${s.y1}" width="${s.x2 - s.x1}" height="${s.y2 - s.y1}" fill="${hex(s.grey)}"/>`
      : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${hex(s.grey)}"/>`,
  ).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${body}\n</svg>\n`;
}

if (import.meta.main) {
  const dir = join(import.meta.dir, '..', 'web', 'public', 'icons');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'icon.svg'), svg());
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ] as const) {
    writeFileSync(join(dir, name), encodePng(size, render(size)));
    console.log(`wrote web/public/icons/${name}`);
  }
  console.log('wrote web/public/icons/icon.svg');
}
