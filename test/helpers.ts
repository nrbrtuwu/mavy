// Test helpers: a stand-in for the built frontend (dist/public), so server tests
// do not depend on running the Vite build first.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WEB_PUBLIC = join(import.meta.dir, '..', 'web', 'public');

/** Temp folder shaped like dist/public: web/public files plus a tiny index.html and assets. */
export function makePublicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mavy-public-'));
  cpSync(WEB_PUBLIC, dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Mávy</title><div id="root"></div>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("mavy")');
  return dir;
}
