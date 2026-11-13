// PWA files: manifest, icons, service worker build injection.
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from '../src/server.ts';
import { makePublicDir, WEB_PUBLIC } from './helpers.ts';

const WEB = join(import.meta.dir, '..', 'web');
const app = buildServer({ dbPath: join(import.meta.dir, 'no-such.db'), publicDir: makePublicDir(), logger: false });
afterAll(() => app.close());

/** Theme, splash and icon colors stay neutral (r = g = b); red is only for delays in the UI. */
function isNeutral(hex: string): boolean {
  const h = hex.replace('#', '');
  return h.length === 6 && h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
}

/** Width, height and colour type from a PNG header. */
function pngInfo(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25] };
}

describe('manifest', () => {
  it('is served with the manifest type and is installable', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/manifest+json');
    const m = res.json();
    expect(m).toMatchObject({ name: 'Mávy', short_name: 'Mávy', display: 'standalone', start_url: './#/' });
    expect(isNeutral(m.theme_color)).toBe(true);
    expect(isNeutral(m.background_color)).toBe(true);
    const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192/any', '512x512/any', '512x512/maskable']));
  });

  it('icons exist with the declared sizes and are greyscale', () => {
    expect(pngInfo(join(WEB_PUBLIC, 'icons/icon-192.png'))).toEqual({ width: 192, height: 192, colourType: 0 });
    expect(pngInfo(join(WEB_PUBLIC, 'icons/icon-512.png'))).toEqual({ width: 512, height: 512, colourType: 0 });
    expect(pngInfo(join(WEB_PUBLIC, 'icons/apple-touch-icon.png'))).toEqual({ width: 180, height: 180, colourType: 0 });
    const svg = readFileSync(join(WEB_PUBLIC, 'icons/icon.svg'), 'utf8');
    for (const c of svg.match(/#[0-9a-f]{6}/gi) ?? []) expect(isNeutral(c.toLowerCase())).toBe(true);
  });

  it('web/index.html links manifest and iOS icon, theme colors neutral', () => {
    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    for (const c of html.match(/#[0-9a-f]{6}/gi) ?? []) expect(isNeutral(c.toLowerCase())).toBe(true);
  });
});

describe('service worker', () => {
  it('is served with the real file list and a content hash', async () => {
    const res = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toBe('no-cache');
    const line = res.body.split('\n').find((l) => l.startsWith('const BUILD = '))!;
    const build = JSON.parse(line.slice('const BUILD = '.length, line.lastIndexOf('; // @build')));
    expect(build.version).toMatch(/^[0-9a-f]{12}$/);
    expect(build.files).toEqual(
      expect.arrayContaining(['./', 'index.html', 'assets/index-abc123.js', 'manifest.webmanifest', 'icons/icon-192.png']),
    );
    expect(build.files).not.toContain('sw.js');
    // Same content -> same version.
    const again = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(again.body).toBe(res.body);
  });
});
