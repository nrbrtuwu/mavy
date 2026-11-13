// GTFS zip in data/gtfs/ -> SQLite (data/mavy.db).
//
// Usage: bun run import-gtfs
// Env overrides: MAVY_GTFS_DIR (input folder), MAVY_DB (output database path).
//
// The database is built in a temp file and renamed into place at the end,
// so a failed import never breaks the existing database.

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const GTFS_DIR = resolve(process.env.MAVY_GTFS_DIR ?? join(import.meta.dir, '../../data/gtfs'));
export const DB_PATH = resolve(process.env.MAVY_DB ?? join(import.meta.dir, '../../data/mavy.db'));

export class ImportError extends Error {}

// ---------------------------------------------------------------- parsing

/** "25:10:00" -> seconds after midnight of the service day (can exceed 86400). */
export function parseGtfsTime(value: string): number | null {
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Lowercase, accents removed: "Győr-Gyárváros" -> "gyor-gyarvaros". Used for station search. */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Parse one CSV record (RFC 4180 quoting). */
export function parseLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

function countQuotes(s: string): number {
  let n = 0;
  for (let i = s.indexOf('"'); i !== -1; i = s.indexOf('"', i + 1)) n++;
  return n;
}

/**
 * Stream a CSV file record by record. Handles UTF-8 BOM, CRLF, quoted fields
 * and quoted line breaks. Blank lines are skipped.
 */
export async function* readCsv(path: string): AsyncGenerator<string[]> {
  const decoder = new TextDecoder('utf-8'); // strips a leading BOM
  let buf = '';
  let pending: string | null = null; // record with an open quote, waiting for its next line

  function* handle(raw: string): Generator<string[]> {
    let line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (pending !== null) {
      line = pending + '\n' + line;
      pending = null;
    }
    if (line.includes('"') && countQuotes(line) % 2 === 1) {
      pending = line;
      return;
    }
    if (line !== '') yield parseLine(line);
  }

  for await (const chunk of Bun.file(path).stream()) {
    buf += decoder.decode(chunk, { stream: true });
    let start = 0;
    let nl: number;
    while ((nl = buf.indexOf('\n', start)) !== -1) {
      yield* handle(buf.slice(start, nl));
      start = nl + 1;
    }
    buf = buf.slice(start);
  }
  buf += decoder.decode();
  if (buf !== '') yield* handle(buf);
  if (pending !== null) yield parseLine(pending); // unterminated quote: best effort
}

// ---------------------------------------------------------------- schema

type Kind = 'text' | 'int' | 'real' | 'time';
type Value = string | number | null;
type Row = Record<string, Value>;

interface TableSpec {
  file: string;
  table: string;
  required: boolean;
  /** Columns that must be present in the header. */
  key: string[];
  columns: Record<string, Kind>;
  derived?: Record<string, (row: Row) => Value>;
}

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE stops (
  stop_id TEXT PRIMARY KEY, stop_code TEXT, stop_name TEXT, stop_name_norm TEXT,
  stop_lat REAL, stop_lon REAL, location_type INTEGER, parent_station TEXT, platform_code TEXT
);
CREATE TABLE routes (
  route_id TEXT PRIMARY KEY, agency_id TEXT, route_short_name TEXT, route_long_name TEXT,
  route_desc TEXT, route_type INTEGER
);
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY, route_id TEXT NOT NULL, service_id TEXT NOT NULL,
  trip_headsign TEXT, trip_short_name TEXT, direction_id INTEGER, block_id TEXT
);
-- Times are seconds after midnight of the service day; values >= 86400 are past midnight.
CREATE TABLE stop_times (
  trip_id TEXT NOT NULL, stop_sequence INTEGER NOT NULL, stop_id TEXT NOT NULL,
  arrival_time INTEGER, departure_time INTEGER, stop_headsign TEXT,
  pickup_type INTEGER, drop_off_type INTEGER,
  PRIMARY KEY (trip_id, stop_sequence)
) WITHOUT ROWID;
CREATE TABLE calendar (
  service_id TEXT PRIMARY KEY,
  monday INTEGER, tuesday INTEGER, wednesday INTEGER, thursday INTEGER,
  friday INTEGER, saturday INTEGER, sunday INTEGER,
  start_date TEXT, end_date TEXT
);
CREATE TABLE calendar_dates (
  service_id TEXT NOT NULL, date TEXT NOT NULL, exception_type INTEGER NOT NULL,
  PRIMARY KEY (service_id, date)
) WITHOUT ROWID;
`;

// Created after loading (faster). trip_id is covered by the primary keys of
// trips and stop_times (trip_id is the leading column there).
const INDEXES = `
CREATE INDEX idx_stops_name ON stops(stop_name);
CREATE INDEX idx_stops_name_norm ON stops(stop_name_norm);
CREATE INDEX idx_stops_parent ON stops(parent_station);
CREATE INDEX idx_stop_times_stop ON stop_times(stop_id, departure_time);
CREATE INDEX idx_trips_service ON trips(service_id);
CREATE INDEX idx_trips_short_name ON trips(trip_short_name);
CREATE INDEX idx_calendar_dates_date ON calendar_dates(date);
`;

const TABLES: TableSpec[] = [
  {
    file: 'stops.txt',
    table: 'stops',
    required: true,
    key: ['stop_id', 'stop_name'],
    columns: {
      stop_id: 'text', stop_code: 'text', stop_name: 'text', stop_lat: 'real', stop_lon: 'real',
      location_type: 'int', parent_station: 'text', platform_code: 'text',
    },
    derived: {
      stop_name_norm: (r) => (typeof r.stop_name === 'string' ? normalizeName(r.stop_name) : null),
    },
  },
  {
    file: 'routes.txt',
    table: 'routes',
    required: true,
    key: ['route_id'],
    columns: {
      route_id: 'text', agency_id: 'text', route_short_name: 'text', route_long_name: 'text',
      route_desc: 'text', route_type: 'int',
    },
  },
  {
    file: 'trips.txt',
    table: 'trips',
    required: true,
    key: ['trip_id', 'route_id', 'service_id'],
    columns: {
      trip_id: 'text', route_id: 'text', service_id: 'text', trip_headsign: 'text',
      trip_short_name: 'text', direction_id: 'int', block_id: 'text',
    },
  },
  {
    file: 'stop_times.txt',
    table: 'stop_times',
    required: true,
    key: ['trip_id', 'stop_sequence', 'stop_id'],
    columns: {
      trip_id: 'text', stop_sequence: 'int', stop_id: 'text', arrival_time: 'time',
      departure_time: 'time', stop_headsign: 'text', pickup_type: 'int', drop_off_type: 'int',
    },
  },
  {
    file: 'calendar.txt',
    table: 'calendar',
    required: false,
    key: ['service_id', 'start_date', 'end_date'],
    columns: {
      service_id: 'text', monday: 'int', tuesday: 'int', wednesday: 'int', thursday: 'int',
      friday: 'int', saturday: 'int', sunday: 'int', start_date: 'text', end_date: 'text',
    },
  },
  {
    file: 'calendar_dates.txt',
    table: 'calendar_dates',
    required: false,
    key: ['service_id', 'date', 'exception_type'],
    columns: { service_id: 'text', date: 'text', exception_type: 'int' },
  },
];

function convert(raw: string | undefined, kind: Kind): Value {
  if (raw === undefined) return null;
  const v = raw.trim();
  if (v === '') return null;
  switch (kind) {
    case 'text':
      return v;
    case 'int': {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    }
    case 'real': {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'time':
      return parseGtfsTime(v);
  }
}

// ---------------------------------------------------------------- loading

interface TableResult {
  read: number;
  inserted: number;
}

async function loadTable(db: Database, dir: string, spec: TableSpec): Promise<TableResult> {
  const path = join(dir, spec.file);
  if (!existsSync(path)) {
    if (spec.required) throw new ImportError(`The GTFS feed has no ${spec.file}.`);
    return { read: 0, inserted: 0 };
  }

  const records = readCsv(path);
  const first = await records.next();
  if (first.done) return { read: 0, inserted: 0 };
  const header = first.value.map((h) => h.trim());

  const missing = spec.key.filter((k) => !header.includes(k));
  if (missing.length > 0) {
    throw new ImportError(`${spec.file} is missing required column(s): ${missing.join(', ')}`);
  }

  const columns = Object.entries(spec.columns).map(([name, kind]) => ({ name, kind, idx: header.indexOf(name) }));
  const derived = Object.entries(spec.derived ?? {});
  const names = [...columns.map((c) => c.name), ...derived.map(([n]) => n)];
  // OR IGNORE: duplicate keys or rows without a key are skipped (and counted) instead of aborting.
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ${spec.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  );

  let read = 0;
  let inserted = 0;
  let batch: Value[][] = [];
  const flush = db.transaction((rows: Value[][]) => {
    for (const values of rows) inserted += stmt.run(...values).changes;
  });

  try {
    for await (const record of records) {
      const row: Row = {};
      for (const c of columns) row[c.name] = c.idx === -1 ? null : convert(record[c.idx], c.kind);
      for (const [name, fn] of derived) row[name] = fn(row);
      batch.push(names.map((n) => row[n] ?? null));
      read++;
      if (batch.length >= 20000) {
        flush(batch);
        batch = [];
      }
    }
    flush(batch);
  } finally {
    stmt.finalize(); // unfinalized statements keep the file open on Windows
  }
  return { read, inserted };
}

async function readFeedInfo(dir: string): Promise<Record<string, string>> {
  const path = join(dir, 'feed_info.txt');
  if (!existsSync(path)) return {};
  const records = readCsv(path);
  const header = await records.next();
  const row = await records.next();
  if (header.done || row.done) return {};
  const out: Record<string, string> = {};
  header.value.forEach((h, i) => {
    const v = row.value[i]?.trim();
    if (v) out[h.trim()] = v;
  });
  return out;
}

export interface ImportSummary {
  counts: Record<string, TableResult>;
  feedStartDate: string | null;
  feedEndDate: string | null;
  dbPath: string;
}

/** Import an extracted GTFS folder into a fresh SQLite database at dbPath. */
export async function importGtfs(dir: string, dbPath: string, sourceName = basename(dir)): Promise<ImportSummary> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  rmSync(tmpPath, { force: true });

  const db = new Database(tmpPath, { create: true });
  const counts: Record<string, TableResult> = {};
  let feedStartDate: string | null = null;
  let feedEndDate: string | null = null;
  try {
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
    db.exec(SCHEMA);
    for (const spec of TABLES) counts[spec.table] = await loadTable(db, dir, spec);

    if ((counts.calendar?.inserted ?? 0) + (counts.calendar_dates?.inserted ?? 0) === 0) {
      throw new ImportError('The GTFS feed has no service calendar (calendar.txt or calendar_dates.txt).');
    }

    // Fill missing arrival/departure from each other.
    db.exec(`
      UPDATE stop_times SET departure_time = arrival_time WHERE departure_time IS NULL;
      UPDATE stop_times SET arrival_time = departure_time WHERE arrival_time IS NULL;
    `);
    db.exec(INDEXES);

    const info = await readFeedInfo(dir);
    const rangeStmt = db.prepare<{ start: string | null; end: string | null }, []>(
      `SELECT MIN(d) AS start, MAX(d) AS end FROM (
         SELECT start_date AS d FROM calendar UNION ALL SELECT end_date FROM calendar
         UNION ALL SELECT date FROM calendar_dates WHERE exception_type = 1)`,
    );
    const range = rangeStmt.get();
    rangeStmt.finalize();
    feedStartDate = info.feed_start_date ?? range?.start ?? null;
    feedEndDate = info.feed_end_date ?? range?.end ?? null;

    const meta: Record<string, string | null> = {
      imported_at: new Date().toISOString(),
      source: sourceName,
      feed_start_date: feedStartDate,
      feed_end_date: feedEndDate,
      feed_version: info.feed_version ?? null,
      feed_publisher_name: info.feed_publisher_name ?? null,
    };
    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(meta)) insertMeta.run(k, v);
    insertMeta.finalize();

    db.exec('ANALYZE;');
    db.close(true);
  } catch (err) {
    db.close();
    rmSync(tmpPath, { force: true });
    throw err;
  }

  try {
    renameSync(tmpPath, dbPath);
  } catch (err) {
    throw new ImportError(
      `Could not replace ${dbPath} (${(err as Error).message}). ` +
        `If the server is running, stop it and run the import again. The new database is at ${tmpPath}.`,
    );
  }
  return { counts, feedStartDate, feedEndDate, dbPath };
}

// ---------------------------------------------------------------- input discovery

export type GtfsSource = { kind: 'zip'; path: string } | { kind: 'dir'; path: string } | { kind: 'none' };

/** Newest *.zip in the folder, else an already-extracted feed (stops.txt), else none. */
export function findSource(dir: string): GtfsSource {
  if (!existsSync(dir)) return { kind: 'none' };
  const zips = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (zips[0]) return { kind: 'zip', path: zips[0] };
  if (existsSync(join(dir, 'stops.txt'))) return { kind: 'dir', path: dir };
  return { kind: 'none' };
}

/** Find the folder holding stops.txt (the zip may contain a subfolder). */
export function findGtfsRoot(dir: string): string | null {
  if (existsSync(join(dir, 'stops.txt'))) return dir;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(dir, entry.name, 'stops.txt'))) return join(dir, entry.name);
  }
  return null;
}

/**
 * Extract a zip with tools the OS already has (no npm dependency):
 * Windows 10+ ships bsdtar as System32\tar.exe; Linux/macOS use unzip or bsdtar.
 */
export function extractZip(zipPath: string, destDir: string): void {
  const commands: string[][] = [];
  if (process.platform === 'win32') {
    commands.push([join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), '-xf', zipPath, '-C', destDir]);
  }
  commands.push(['unzip', '-o', '-q', zipPath, '-d', destDir]);
  commands.push(['bsdtar', '-xf', zipPath, '-C', destDir]);

  const errors: string[] = [];
  for (const cmd of commands) {
    try {
      const res = Bun.spawnSync(cmd, { stdout: 'ignore', stderr: 'pipe' });
      if (res.exitCode === 0) return;
      errors.push(`${basename(cmd[0]!)}: ${res.stderr.toString().trim() || `exit code ${res.exitCode}`}`);
    } catch {
      errors.push(`${basename(cmd[0]!)}: not installed`);
    }
  }
  throw new ImportError(
    `Could not extract ${basename(zipPath)}.\n  ${errors.join('\n  ')}\n` +
      'Install "unzip" (e.g. apt install unzip), or extract the zip into data/gtfs/ yourself and run the import again.',
  );
}

function instructions(dir: string): string {
  return [
    'No GTFS feed found.',
    '',
    'To import the MÁV timetable:',
    '  1. Register for free as a developer on mavcsoport.hu and download the GTFS zip.',
    '     Check the current download location and terms on the site first.',
    `  2. Put the zip file in: ${dir}`,
    '     Any file name ending in .zip works. If there are several, the newest one is used.',
    '  3. Run: bun run import-gtfs',
  ].join('\n');
}

// ---------------------------------------------------------------- CLI

async function main(): Promise<void> {
  const source = findSource(GTFS_DIR);
  if (source.kind === 'none') {
    console.log(instructions(GTFS_DIR));
    process.exitCode = 1;
    return;
  }

  const started = performance.now();
  let tmp: string | null = null;
  try {
    let dir = source.path;
    if (source.kind === 'zip') {
      console.log(`Extracting ${basename(source.path)} ...`);
      tmp = mkdtempSync(join(tmpdir(), 'mavy-gtfs-'));
      extractZip(source.path, tmp);
      const root = findGtfsRoot(tmp);
      if (!root) throw new ImportError(`${basename(source.path)} does not contain stops.txt. Is it a GTFS feed?`);
      dir = root;
    }

    console.log('Importing ...');
    const summary = await importGtfs(dir, DB_PATH, basename(source.path));
    for (const [table, { read, inserted }] of Object.entries(summary.counts)) {
      const skipped = read - inserted;
      console.log(`  ${table.padEnd(15)} ${String(inserted).padStart(9)}${skipped ? `  (${skipped} skipped: duplicate or missing key)` : ''}`);
    }
    console.log(`Feed valid ${summary.feedStartDate ?? '?'} - ${summary.feedEndDate ?? '?'}`);
    console.log(`Wrote ${summary.dbPath} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  } catch (err) {
    if (!(err instanceof ImportError)) throw err;
    console.error(`Import failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
