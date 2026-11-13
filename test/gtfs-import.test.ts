import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ImportError,
  extractZip,
  findGtfsRoot,
  findSource,
  importGtfs,
  normalizeName,
  parseGtfsTime,
  readCsv,
} from '../src/gtfs/import.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'gtfs');
const ROOT = resolve(import.meta.dir, '..');
let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mavy-test-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function newDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function collect(path: string): Promise<string[][]> {
  const out: string[][] = [];
  for await (const r of readCsv(path)) out.push(r);
  return out;
}

describe('readCsv', () => {
  test('handles BOM, CRLF, quotes, escaped quotes, quoted line breaks and blank lines', async () => {
    const path = join(newDir('csv'), 'a.txt');
    writeFileSync(path, '\uFEFFa,b,c\r\n1,"x, y","say ""hi"""\r\n2,"multi\nline",\r\n\r\n3,Győr,\r\n');
    expect(await collect(path)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'multi\nline', ''],
      ['3', 'Győr', ''],
    ]);
  });

  test('reads a file without trailing newline', async () => {
    const path = join(newDir('csv2'), 'b.txt');
    writeFileSync(path, 'a,b\n1,2');
    expect(await collect(path)).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('helpers', () => {
  test('parseGtfsTime handles times past 24:00', () => {
    expect(parseGtfsTime('07:05:09')).toBe(7 * 3600 + 5 * 60 + 9);
    expect(parseGtfsTime('24:35:00')).toBe(88500);
    expect(parseGtfsTime(' 5:00:00')).toBe(18000);
    expect(parseGtfsTime('')).toBeNull();
    expect(parseGtfsTime('7:60:00')).toBeNull();
    expect(parseGtfsTime('abc')).toBeNull();
  });

  test('normalizeName strips Hungarian accents', () => {
    expect(normalizeName('Győr-Gyárváros')).toBe('gyor-gyarvaros');
    expect(normalizeName(' Hódmezővásárhely ')).toBe('hodmezovasarhely');
  });
});

describe('importGtfs', () => {
  test('loads the fixture with times, normalized names, indexes and meta', async () => {
    const dbPath = join(tmp, 'a.db');
    const summary = await importGtfs(FIXTURE, dbPath);
    expect(summary.counts.stops?.inserted).toBe(5);
    expect(summary.counts.trips?.inserted).toBe(4);
    expect(summary.counts.stop_times?.inserted).toBe(11);
    expect(summary.counts.calendar?.inserted).toBe(2);
    expect(summary.counts.calendar_dates?.inserted).toBe(2);
    expect(existsSync(`${dbPath}.tmp`)).toBe(false);

    const db = new Database(dbPath, { readonly: true });
    const st = db
      .query<{ arrival_time: number; departure_time: number }, [string, number]>(
        'SELECT arrival_time, departure_time FROM stop_times WHERE trip_id = ? AND stop_sequence = ?',
      );
    expect(st.get('T4', 2)).toEqual({ arrival_time: 24 * 3600 + 50 * 60, departure_time: 24 * 3600 + 52 * 60 });
    // Missing departure is filled from arrival.
    expect(st.get('T4', 3)).toEqual({ arrival_time: 26 * 3600 + 5 * 60, departure_time: 26 * 3600 + 5 * 60 });

    expect(db.query('SELECT stop_name, stop_name_norm FROM stops WHERE stop_id = ?').get('GYOR')).toEqual({
      stop_name: 'Győr',
      stop_name_norm: 'gyor',
    });
    expect(db.query('SELECT trip_short_name FROM trips WHERE trip_id = ?').get('T1')).toEqual({ trip_short_name: '6212' });

    const indexes = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_stops_name', 'idx_stops_name_norm', 'idx_stop_times_stop', 'idx_trips_service']),
    );

    const meta = Object.fromEntries(
      db.query<{ key: string; value: string }, []>('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]),
    );
    expect(meta.feed_start_date).toBe('20261101');
    expect(meta.feed_end_date).toBe('20261231');
    expect(meta.feed_version).toBe('test-1');
    db.close();

    // Re-import over the existing file works.
    await importGtfs(FIXTURE, dbPath);
  });

  test('a broken feed fails cleanly and keeps the existing database', async () => {
    const dbPath = join(tmp, 'keep.db');
    await importGtfs(FIXTURE, dbPath);

    const broken = newDir('broken');
    for (const f of ['stops.txt', 'routes.txt', 'trips.txt', 'calendar.txt']) copyFileSync(join(FIXTURE, f), join(broken, f));
    await expect(importGtfs(broken, dbPath)).rejects.toBeInstanceOf(ImportError);

    expect(existsSync(`${dbPath}.tmp`)).toBe(false);
    const db = new Database(dbPath, { readonly: true });
    expect(db.query('SELECT COUNT(*) AS n FROM stop_times').get()).toEqual({ n: 11 });
    db.close();
  });

  test('a feed without any calendar is rejected', async () => {
    const dir = newDir('nocal');
    for (const f of ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) copyFileSync(join(FIXTURE, f), join(dir, f));
    await expect(importGtfs(dir, join(tmp, 'nocal.db'))).rejects.toThrow(/service calendar/);
  });
});

describe('input discovery', () => {
  test('findSource: empty folder, .gitkeep only, extracted feed, zip', () => {
    expect(findSource(join(tmp, 'does-not-exist'))).toEqual({ kind: 'none' });
    const dir = newDir('src');
    writeFileSync(join(dir, '.gitkeep'), '');
    expect(findSource(dir)).toEqual({ kind: 'none' });
    copyFileSync(join(FIXTURE, 'stops.txt'), join(dir, 'stops.txt'));
    expect(findSource(dir)).toEqual({ kind: 'dir', path: dir });
    writeFileSync(join(dir, 'gtfs.zip'), '');
    expect(findSource(dir)).toEqual({ kind: 'zip', path: join(dir, 'gtfs.zip') });
  });

  test('CLI prints instructions and exits 1 when the folder is empty', () => {
    const res = Bun.spawnSync([process.execPath, 'src/gtfs/import.ts'], {
      cwd: ROOT,
      env: { ...process.env, MAVY_GTFS_DIR: newDir('empty'), MAVY_DB: join(tmp, 'cli.db') },
    });
    expect(res.exitCode).toBe(1);
    expect(res.stdout.toString()).toContain('No GTFS feed found');
    expect(res.stderr.toString()).toBe('');
    expect(existsSync(join(tmp, 'cli.db'))).toBe(false);
  }, 30_000); // starts a separate bun process: can exceed the 5 s default on a busy machine

  // Builds a real zip with the OS tool; skipped where none is available.
  const files = readdirSync(FIXTURE);
  function makeZip(zipPath: string): boolean {
    const cmd =
      process.platform === 'win32'
        ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), '-a', '-cf', zipPath, '-C', FIXTURE, ...files]
        : ['zip', '-j', '-q', zipPath, ...files.map((f) => join(FIXTURE, f))];
    try {
      return Bun.spawnSync(cmd).exitCode === 0;
    } catch {
      return false;
    }
  }

  test('extractZip + findGtfsRoot + CLI import from a zip', () => {
    const dir = newDir('zipped');
    const zip = join(dir, 'mav-gtfs.zip');
    if (!makeZip(zip)) {
      console.warn('no zip tool available, skipping zip test');
      return;
    }
    const out = newDir('unzipped');
    extractZip(zip, out);
    expect(findGtfsRoot(out)).toBe(out);

    const dbPath = join(tmp, 'zip.db');
    const res = Bun.spawnSync([process.execPath, 'src/gtfs/import.ts'], {
      cwd: ROOT,
      env: { ...process.env, MAVY_GTFS_DIR: dir, MAVY_DB: dbPath },
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.toString()).toContain('stop_times');
    expect(existsSync(dbPath)).toBe(true);
  }, 30_000); // zips, unzips and starts a separate bun process
});
