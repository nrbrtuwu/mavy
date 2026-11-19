// Local station search must match the server's /api/stations (same set, same order).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGtfs } from '../src/gtfs/import.ts';
import { Timetable } from '../src/gtfs/queries.ts';
import { indexStations, normalizeName, searchStationsLocal } from '../web/src/lib/stations.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'gtfs');
let tmp: string;
let tt: Timetable;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mavy-st-'));
  await importGtfs(FIXTURE, join(tmp, 'st.db'));
  tt = new Timetable(join(tmp, 'st.db'));
});
afterAll(() => {
  tt.close();
  rmSync(tmp, { recursive: true, force: true });
});

const sample = indexStations([
  { id: 'A', name: 'Budapest-Keleti' },
  { id: 'B', name: 'Budapest-Nyugati' },
  { id: 'C', name: 'Győr' },
  { id: 'D', name: 'Győr-Gyárváros' },
  { id: 'E', name: 'Kőbánya-Kispest' },
  { id: 'F', name: 'Keleti út' },
]);

describe('local station search', () => {
  test('accent and case insensitive', () => {
    expect(normalizeName('Győr-Gyárváros')).toBe('gyor-gyarvaros');
    expect(searchStationsLocal(sample, 'GYOR').map((s) => s.id)).toEqual(['C', 'D']);
    expect(searchStationsLocal(sample, 'kobanya').map((s) => s.id)).toEqual(['E']);
  });

  test('names starting with the query first, then shorter, then alphabetical', () => {
    expect(searchStationsLocal(sample, 'keleti').map((s) => s.name)).toEqual(['Keleti út', 'Budapest-Keleti']);
    expect(searchStationsLocal(sample, 'budapest').map((s) => s.name)).toEqual(['Budapest-Keleti', 'Budapest-Nyugati']);
  });

  test('limit, empty query, results are plain stations', () => {
    expect(searchStationsLocal(sample, 'e', 2)).toHaveLength(2);
    expect(searchStationsLocal(sample, '  ')).toEqual([]);
    expect(searchStationsLocal(sample, 'gyor')[0]).toEqual({ id: 'C', name: 'Győr' });
  });

  test('same results as the server search on the fixture feed', () => {
    const list = indexStations(tt.allStations());
    for (const q of ['keleti', 'gyor', 'BUDA', 'szol', 'deb', 'xyz']) {
      expect(searchStationsLocal(list, q)).toEqual(tt.searchStations(q));
    }
  });
});
