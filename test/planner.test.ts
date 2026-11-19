// Journey planner on the fixture feed plus two extra trains from Szolnok to Győr:
//   T9  Szolnok 08:30 -> Győr 10:00   (10 min after T1 reaches Szolnok: catchable)
//   T10 Szolnok 08:21 -> Győr 09:30   (1 min after: too short a change)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGtfs } from '../src/gtfs/import.ts';
import { beats, planJourneys } from '../src/gtfs/planner.ts';
import { Timetable } from '../src/gtfs/queries.ts';
import { directIsBetter } from '../src/merge.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'gtfs');
let tmp: string;
let tt: Timetable;
const at = (local: string) => Date.parse(`${local}+01:00`);

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mavy-plan-'));
  const feed = join(tmp, 'feed');
  cpSync(FIXTURE, feed, { recursive: true });
  appendFileSync(join(feed, 'trips.txt'), 'R2,DAILY,T9,Győr,950,1\nR2,DAILY,T10,Győr,951,1\n');
  appendFileSync(
    join(feed, 'stop_times.txt'),
    'T9,08:30:00,08:30:00,SZOL,1\nT9,10:00:00,10:00:00,GYOR,2\nT10,08:21:00,08:21:00,SZOL,1\nT10,09:30:00,09:30:00,GYOR,2\n',
  );
  await importGtfs(feed, join(tmp, 'p.db'));
  tt = new Timetable(join(tmp, 'p.db'));
});
afterAll(() => {
  tt.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('planJourneys', () => {
  test('finds a trip with one change, with enough time to change', () => {
    const [first] = planJourneys(tt, 'BPK', 'GYOR', { time: at('2026-11-12T06:55'), limit: 1 })!;
    expect(first!.legs.map((l) => [l.trainNumber, l.from.id, l.to.id])).toEqual([
      ['6212', 'BPK', 'SZOL'],
      ['950', 'SZOL', 'GYOR'],
    ]);
    expect(first).toMatchObject({ departure: '2026-11-12T07:00:00+01:00', arrival: '2026-11-12T10:00:00+01:00', durationMin: 180 });
    expect(first!.legs[0]!.fromPlatform).toBe('1');
  });

  test('a direct train is one leg; same station or unknown station gives nothing', () => {
    const direct = planJourneys(tt, 'BPK', 'DEB', { time: at('2026-11-12T06:55'), limit: 1 })!;
    expect(direct[0]!.legs).toHaveLength(1);
    expect(planJourneys(tt, 'BPK', 'BPK_1', { time: at('2026-11-12T06:55') })).toEqual([]);
    expect(planJourneys(tt, 'BPK', 'NOPE', { time: at('2026-11-12T06:55') })).toBeNull();
  });

  test('options: later departures, none beaten by another', () => {
    const js = planJourneys(tt, 'BPK', 'GYOR', { time: at('2026-11-12T06:55'), limit: 5 })!;
    for (const j of js) expect(js.some((k) => beats(k, j))).toBe(false);
    const deps = js.map((j) => j.departure);
    expect([...deps].sort()).toEqual(deps);
  });
});

describe('direct trains win', () => {
  test('a direct train leaving no earlier and arriving no later drops the trip with changes', () => {
    const j = { departure: '2026-11-12T07:00:00+01:00', arrival: '2026-11-12T10:00:00+01:00', legs: [] } as any;
    const direct = (dep: string, arr: string) => ({ departure: `2026-11-12T${dep}:00+01:00`, arrival: `2026-11-12T${arr}:00+01:00` }) as any;
    expect(directIsBetter(j, [direct('07:05', '09:50')])).toBe(true);
    expect(directIsBetter(j, [direct('06:50', '09:50')])).toBe(false);
    expect(directIsBetter(j, [direct('07:05', '10:30')])).toBe(false);
  });
});
