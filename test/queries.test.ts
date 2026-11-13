// Fixture calendar (see test/fixtures/gtfs):
//   WK     Mon-Fri, Nov 1 - Dec 31 2026, removed on Fri Dec 25   -> T1 (6212)
//   DAILY  every day, Nov 1 - Dec 31 2026                        -> T2 (6214), T4 (6299, night train past midnight)
//   EXTRA  only Sat Dec 26 (calendar_dates)                      -> T3 (942, Budapest - Győr)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGtfs } from '../src/gtfs/import.ts';
import { Timetable, describeTrain } from '../src/gtfs/queries.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'gtfs');
let tmp: string;
let tt: Timetable;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mavy-q-'));
  await importGtfs(FIXTURE, join(tmp, 'q.db'));
  tt = new Timetable(join(tmp, 'q.db'));
});
afterAll(() => {
  tt.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Budapest local time in winter (+01:00). */
const at = (local: string) => Date.parse(`${local}+01:00`);
const trains = (list: { trainNumber: string | null }[]) => list.map((d) => d.trainNumber);

describe('describeTrain (shapes seen in the real MÁV feed)', () => {
  const d = (trip_short_name: string | null, route_short_name: string | null, route_long_name: string | null) =>
    describeTrain({ trip_short_name, route_short_name, route_long_name });

  test('number and name from route_long_name', () => {
    expect(d(null, null, 'IC 562 TOKAJ')).toEqual({ trainNumber: '562', label: 'IC 562 TOKAJ' });
    expect(d(null, null, 'Sz 359 ')).toEqual({ trainNumber: '359', label: 'Sz 359' });
    expect(d(null, null, 'Pótló 8803 FENYVES')).toEqual({ trainNumber: '8803', label: 'Pótló 8803 FENYVES' });
    expect(d(null, null, '39830 ')).toEqual({ trainNumber: '39830', label: '39830' });
    expect(d(null, null, 'rjx 62')).toEqual({ trainNumber: '62', label: 'rjx 62' });
  });

  test('suburban lines: line code only, no train number', () => {
    expect(d(null, 'S80', null)).toEqual({ trainNumber: null, label: 'S80' });
    expect(d(null, 'IR85', 'MÁTRA')).toEqual({ trainNumber: null, label: 'IR85 MÁTRA' });
  });

  test('feeds with trip_short_name', () => {
    expect(d('6212', null, 'Budapest - Debrecen')).toEqual({ trainNumber: '6212', label: '6212 Budapest - Debrecen' });
    expect(d('IC 600', null, 'IC 600 KŐRÖS')).toEqual({ trainNumber: '600', label: 'IC 600 KŐRÖS' });
    expect(d(null, null, null)).toEqual({ trainNumber: null, label: null });
  });
});

describe('stations', () => {
  test('search ignores accents and case, returns only top-level stations', () => {
    expect(tt.searchStations('gyor')).toEqual([{ id: 'GYOR', name: 'Győr' }]);
    expect(tt.searchStations('KELETI')).toEqual([{ id: 'BPK', name: 'Budapest-Keleti' }]);
    expect(tt.searchStations('xyz')).toEqual([]);
    expect(tt.searchStations('  ')).toEqual([]);
  });

  test('a platform id resolves to its station', () => {
    expect(tt.station('BPK_1')).toEqual({ station: { id: 'BPK', name: 'Budapest-Keleti' }, stopIds: ['BPK', 'BPK_1'] });
    expect(tt.station('NOPE')).toBeNull();
  });
});

describe('departures', () => {
  test('weekday board, sorted, with platform and headsign', () => {
    const res = tt.departures('BPK', { now: at('2026-11-12T06:00:00') })!;
    expect(res.station.name).toBe('Budapest-Keleti');
    expect(trains(res.departures)).toEqual(['6212', '6214', '6299']);
    expect(res.departures[0]).toEqual({
      tripId: 'T1',
      serviceDate: '20261112',
      trainNumber: '6212',
      label: '6212 Budapest - Debrecen',
      headsign: 'Debrecen',
      stopId: 'BPK_1',
      platform: '1',
      departure: '2026-11-12T07:00:00+01:00',
    });
  });

  test('limit', () => {
    expect(trains(tt.departures('BPK', { now: at('2026-11-12T06:00:00'), limit: 2 })!.departures)).toEqual([
      '6212',
      '6214',
    ]);
  });

  test("past midnight: yesterday's night train shows with yesterday's service date", () => {
    const res = tt.departures('SZOL', { now: at('2026-11-13T00:30:00') })!;
    expect(res.departures.map((d) => [d.trainNumber, d.serviceDate, d.departure])).toEqual([
      ['6299', '20261112', '2026-11-13T00:52:00+01:00'],
      ['6212', '20261113', '2026-11-13T08:22:00+01:00'],
      ['6214', '20261113', '2026-11-13T13:22:00+01:00'],
    ]);
  });

  test('calendar_dates: removed on Christmas, extra train on Dec 26', () => {
    expect(trains(tt.departures('BPK', { now: at('2026-12-25T06:00:00') })!.departures)).toEqual(['6214', '6299']);
    expect(trains(tt.departures('BPK', { now: at('2026-12-26T06:00:00') })!.departures)).toEqual([
      '942',
      '6214',
      '6299',
    ]);
  });

  test('weekend: weekday-only train is missing', () => {
    expect(trains(tt.departures('BPK', { now: at('2026-11-14T06:00:00') })!.departures)).toEqual(['6214', '6299']);
  });

  test('outside the feed period: empty board', () => {
    expect(tt.departures('BPK', { now: at('2027-03-01T06:00:00') })!.departures).toEqual([]);
  });

  test('terminus has no departures; unknown station is null', () => {
    expect(tt.departures('DEB', { now: at('2026-11-12T06:00:00') })!.departures).toEqual([]);
    expect(tt.departures('NOPE', { now: at('2026-11-12T06:00:00') })).toBeNull();
  });
});

describe('route', () => {
  test('direct trains A -> B with duration, including past midnight', () => {
    const res = tt.route('BPK', 'DEB', { time: at('2026-11-12T06:00:00') })!;
    expect(res.connections.map((c) => [c.trainNumber, c.departure, c.arrival, c.durationMin])).toEqual([
      ['6212', '2026-11-12T07:00:00+01:00', '2026-11-12T09:50:00+01:00', 170],
      ['6214', '2026-11-12T12:00:00+01:00', '2026-11-12T14:50:00+01:00', 170],
      ['6299', '2026-11-12T23:30:00+01:00', '2026-11-13T02:05:00+01:00', 155],
    ]);
    expect(res.connections[0]!.fromPlatform).toBe('1');
  });

  test('wrong direction finds nothing', () => {
    expect(tt.route('DEB', 'BPK', { time: at('2026-11-12T06:00:00') })!.connections).toEqual([]);
  });

  test('extra train only on its day', () => {
    expect(tt.route('BPK', 'GYOR', { time: at('2026-11-12T06:00:00') })!.connections).toEqual([]);
    const res = tt.route('BPK', 'GYOR', { time: at('2026-12-26T06:00:00') })!;
    expect(res.connections.map((c) => [c.trainNumber, c.arrival])).toEqual([['942', '2026-12-26T11:45:00+01:00']]);
  });

  test('unknown station is null', () => {
    expect(tt.route('BPK', 'NOPE', { time: at('2026-11-12T06:00:00') })).toBeNull();
  });
});

describe('trip', () => {
  test('all stops on a given date, times past 24:00 on the next day', () => {
    const trip = tt.trip('T4', { now: at('2026-11-12T06:00:00'), date: '20261112' })!;
    expect(trip.runsOnDate).toBe(true);
    expect(trip.trainNumber).toBe('6299');
    expect(trip.stops).toEqual([
      { sequence: 1, stopId: 'BPK_1', stationId: 'BPK', name: 'Budapest-Keleti', platform: '1', arrival: null, departure: '2026-11-12T23:30:00+01:00' },
      { sequence: 2, stopId: 'SZOL', stationId: 'SZOL', name: 'Szolnok', platform: null, arrival: '2026-11-13T00:50:00+01:00', departure: '2026-11-13T00:52:00+01:00' },
      { sequence: 3, stopId: 'DEB', stationId: 'DEB', name: 'Debrecen', platform: null, arrival: '2026-11-13T02:05:00+01:00', departure: null },
    ]);
  });

  test('default date: run in progress, else the next one', () => {
    expect(tt.trip('T4', { now: at('2026-11-13T01:00:00') })!.serviceDate).toBe('20261112');
    expect(tt.trip('T4', { now: at('2026-11-13T03:00:00') })!.serviceDate).toBe('20261113');
    expect(tt.trip('T1', { now: at('2026-11-14T08:00:00') })!.serviceDate).toBe('20261113'); // Sat: last run was Fri
  });

  test('runsOnDate is false on a day without service; unknown trip is null', () => {
    expect(tt.trip('T1', { now: at('2026-11-12T06:00:00'), date: '20261114' })!.runsOnDate).toBe(false);
    expect(tt.trip('NOPE', { now: at('2026-11-12T06:00:00') })).toBeNull();
  });
});
