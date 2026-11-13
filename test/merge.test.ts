import { describe, expect, test } from 'bun:test';
import type { PlannedConnection, PlannedDeparture, PlannedTrip } from '../src/gtfs/queries.ts';
import type { LiveBoard, LiveDeparture, LiveResult, LiveSource, LiveStop, LiveTrain } from '../src/live/types.ts';
import {
  isLiveRelevant,
  mergeConnections,
  mergeDepartures,
  mergeTrip,
  safeLive,
  timeInfo,
  trainNumberKey,
} from '../src/merge.ts';

const T = (hhmm: string, day = '12') => `2026-11-${day}T${hhmm}:00+01:00`;
const NOW = Date.parse(T('08:00'));
const FETCHED = '2026-11-12T07:59:30.000Z';

function planned(tripId: string, trainNumber: string, dep: string, extra: Partial<PlannedDeparture> = {}): PlannedDeparture {
  return {
    tripId,
    serviceDate: '20261112',
    trainNumber,
    label: '6212 Budapest - Debrecen',
    headsign: 'Debrecen',
    stopId: 'BPK_1',
    platform: '1',
    departure: dep,
    ...extra,
  };
}

function liveDep(trainNumber: string, extra: Partial<LiveDeparture> = {}): LiveDeparture {
  return {
    tripId: null,
    trainNumber,
    serviceDate: '20261112',
    destination: 'Debrecen',
    plannedDeparture: T('08:30'),
    expectedDeparture: null,
    delayMin: null,
    platform: null,
    cancelled: false,
    reason: null,
    ...extra,
  };
}

function board(departures: LiveDeparture[], stale = false): LiveResult<LiveBoard | null> {
  return { data: { stationCode: null, stationName: 'Budapest-Keleti', departures }, fetchedAt: FETCHED, stale };
}

describe('helpers', () => {
  test('trainNumberKey', () => {
    expect(trainNumberKey('519 TOKAJ InterCity')).toBe('519');
    expect(trainNumberKey('IC 0600')).toBe('600');
    expect(trainNumberKey('6212')).toBe('6212');
    expect(trainNumberKey('S70')).toBe('70');
    expect(trainNumberKey(null)).toBeNull();
  });

  test('timeInfo: expected time wins, else delay is applied, else nothing', () => {
    expect(timeInfo(T('08:30'), T('08:42'), 3)).toEqual({ planned: T('08:30'), expected: T('08:42'), delayMin: 12 });
    expect(timeInfo(T('08:30'), null, 5)).toEqual({ planned: T('08:30'), expected: T('08:35'), delayMin: 5 });
    expect(timeInfo(T('08:30'), null, null)).toEqual({ planned: T('08:30'), expected: null, delayMin: null });
    // Seconds round to the nearest minute.
    expect(timeInfo(T('08:30'), '2026-11-12T08:31:29+01:00', null).delayMin).toBe(1);
    expect(timeInfo(T('08:30'), '2026-11-12T08:31:31+01:00', null).delayMin).toBe(2);
  });

  test('isLiveRelevant: yesterday and today only', () => {
    expect(isLiveRelevant('20261112', NOW)).toBe(true);
    expect(isLiveRelevant('20261111', NOW)).toBe(true);
    expect(isLiveRelevant('20261110', NOW)).toBe(false);
    expect(isLiveRelevant('20261113', NOW)).toBe(false);
  });
});

describe('mergeDepartures', () => {
  const plannedBoard = [
    planned('T1', '6212', T('08:30')),
    planned('T2', '6214', T('08:40')),
    planned('T3', '942', T('08:50')),
    planned('T4', '6299', T('09:00')),
  ];

  test('matches by trip_id, then by train number + service date; others have no live data', () => {
    const res = mergeDepartures(
      plannedBoard,
      board([
        liveDep('9999', { tripId: 'T1', expectedDeparture: T('08:42'), platform: '5' }), // trip_id wins over number
        liveDep('IC 6214', { delayMin: 3 }),
        liveDep('942', { cancelled: true, delayMin: 20, reason: 'Műszaki hiba' }),
        liveDep('1234', { delayMin: 9 }), // not on the planned board: ignored
      ]),
      { now: NOW, limit: 10 },
    );
    expect(res.live).toEqual({ state: 'live', fetchedAt: FETCHED });
    expect(res.departures.map((d) => d.reason)).toEqual([null, null, 'Műszaki hiba', null]);
    expect(res.departures.map((d) => [d.trainNumber, d.departure.delayMin, d.departure.expected, d.cancelled, d.live, d.platform])).toEqual([
      ['6212', 12, T('08:42'), false, 'live', '5'],
      ['6214', 3, T('08:43'), false, 'live', '1'],
      ['942', null, null, true, 'live', '1'],
      ['6299', null, null, false, 'none', '1'],
    ]);
  });

  test('wrong service date does not match', () => {
    const res = mergeDepartures([planned('T1', '6212', T('08:30'))], board([liveDep('6212', { serviceDate: '20261111', delayMin: 4 })]), {
      now: NOW,
      limit: 10,
    });
    expect(res.departures[0]!.live).toBe('none');
  });

  test('without a service date from the source, the planned time must match', () => {
    const live = board([
      liveDep('6212', { serviceDate: null, plannedDeparture: T('08:30'), delayMin: 4 }),
      liveDep('6214', { serviceDate: null, plannedDeparture: T('07:40'), delayMin: 4 }),
    ]);
    const res = mergeDepartures([planned('T1', '6212', T('08:30')), planned('T2', '6214', T('08:40'))], live, { now: NOW, limit: 10 });
    expect(res.departures.map((d) => d.live)).toEqual(['live', 'none']);
  });

  test('a delayed train planned in the past stays; one without live data is dropped', () => {
    const res = mergeDepartures(
      [planned('T0', '100', T('07:40')), planned('T1', '6212', T('07:50')), planned('T2', '6214', T('08:10'))],
      board([liveDep('6212', { tripId: 'T1', expectedDeparture: T('08:05') })]),
      { now: NOW, limit: 10 },
    );
    expect(res.departures.map((d) => [d.trainNumber, d.departure.delayMin])).toEqual([
      ['6212', 15],
      ['6214', null],
    ]);
  });

  test('stale live data is marked stale', () => {
    const res = mergeDepartures([planned('T1', '6212', T('08:30'))], board([liveDep('6212', { delayMin: 2 })], true), { now: NOW, limit: 10 });
    expect(res.live.state).toBe('stale');
    expect(res.departures[0]!.live).toBe('stale');
  });

  test('no live source: planned times only, state none', () => {
    const res = mergeDepartures(plannedBoard, null, { now: NOW, limit: 2 });
    expect(res.live).toEqual({ state: 'none', fetchedAt: null });
    expect(res.departures).toHaveLength(2);
    expect(res.departures[0]!.departure).toEqual({ planned: T('08:30'), expected: null, delayMin: null });
  });

  test('station unknown to the live source: state none', () => {
    const res = mergeDepartures(plannedBoard, { data: null, fetchedAt: FETCHED, stale: false }, { now: NOW, limit: 10 });
    expect(res.live).toEqual({ state: 'none', fetchedAt: FETCHED });
  });

  test('each live entry is used once', () => {
    const res = mergeDepartures(
      [planned('A', '6212', T('08:30')), planned('B', '6212', T('08:30'), { serviceDate: '20261112' })],
      board([liveDep('6212', { delayMin: 2 })]),
      { now: NOW, limit: 10 },
    );
    expect(res.departures.map((d) => d.live)).toEqual(['live', 'none']);
  });
});

describe('mergeConnections', () => {
  test('arrival delay is carried over from the departure', () => {
    const conn: PlannedConnection = {
      tripId: 'T1',
      serviceDate: '20261112',
      trainNumber: '6212',
      label: null,
      headsign: 'Debrecen',
      departure: T('08:30'),
      arrival: T('10:50'),
      durationMin: 140,
      fromPlatform: '1',
      toPlatform: null,
    };
    const res = mergeConnections([conn], board([liveDep('6212', { delayMin: 7, platform: '6' })]), { from: NOW, limit: 5 });
    expect(res.connections[0]).toMatchObject({
      departure: { planned: T('08:30'), expected: T('08:37'), delayMin: 7 },
      arrival: { planned: T('10:50'), expected: T('10:57'), delayMin: 7 },
      fromPlatform: '6',
      live: 'live',
    });
  });
});

describe('mergeTrip', () => {
  const trip: PlannedTrip = {
    tripId: 'T4',
    serviceDate: '20261112',
    trainNumber: '6299',
    label: '6299 Budapest - Debrecen',
    headsign: 'Debrecen',
    runsOnDate: true,
    stops: [
      { sequence: 1, stopId: 'BPK_1', stationId: 'BPK', name: 'Budapest-Keleti', platform: '1', arrival: null, departure: T('23:30') },
      { sequence: 2, stopId: 'SZOL', stationId: 'SZOL', name: 'Szolnok', platform: null, arrival: T('00:50', '13'), departure: T('00:52', '13') },
      { sequence: 3, stopId: 'DEB', stationId: 'DEB', name: 'Debrecen', platform: null, arrival: T('02:05', '13'), departure: null },
    ],
  };

  function liveStop(name: string, extra: Partial<LiveStop> = {}): LiveStop {
    return {
      stationCode: null,
      stationName: name,
      plannedArrival: null,
      plannedDeparture: null,
      expectedArrival: null,
      expectedDeparture: null,
      platform: null,
      cancelled: false,
      passed: null,
      ...extra,
    };
  }

  function liveTrain(extra: Partial<LiveTrain> = {}): LiveResult<LiveTrain | null> {
    return {
      data: {
        tripId: 'T4',
        trainNumber: '6299',
        serviceDate: '20261112',
        cancelled: false,
        delayMin: 10,
        reason: null,
        stops: [
          liveStop('x', { stationCode: 'BPK_1', expectedDeparture: T('23:38'), passed: true, platform: '7' }),
          liveStop('SZOLNOK', { expectedArrival: T('01:00', '13') }), // name match, accents/case ignored
          // Debrecen: no live stop -> train delay applies
        ],
      ...extra,
      },
      fetchedAt: FETCHED,
      stale: false,
    };
  }

  test('stops matched by id and name; missing estimates use the train delay', () => {
    const res = mergeTrip(trip, liveTrain());
    expect(res.live.state).toBe('live');
    expect(res.delayMin).toBe(10);
    expect(res.stops.map((s) => [s.name, s.platform, s.arrival?.delayMin ?? null, s.departure?.delayMin ?? null, s.passed])).toEqual([
      ['Budapest-Keleti', '7', null, 8, true],
      ['Szolnok', null, 10, 10, null],
      ['Debrecen', null, 10, null, null],
    ]);
    expect(res.stops[2]!.arrival).toEqual({ planned: T('02:05', '13'), expected: T('02:15', '13'), delayMin: 10 });
  });

  test('passed stops do not get the fallback delay', () => {
    const res = mergeTrip(
      trip,
      liveTrain({ stops: [liveStop('Budapest-Keleti', { passed: true })] }),
    );
    expect(res.stops[0]!.departure).toEqual({ planned: T('23:30'), expected: null, delayMin: null });
  });

  test('cancelled train: every stop cancelled, no expected times', () => {
    const res = mergeTrip(trip, liveTrain({ cancelled: true }));
    expect(res.cancelled).toBe(true);
    expect(res.stops.every((s) => s.cancelled)).toBe(true);
    expect(res.stops[1]!.arrival).toEqual({ planned: T('00:50', '13'), expected: null, delayMin: null });
  });

  test('a single cancelled stop', () => {
    const res = mergeTrip(trip, liveTrain({ stops: [liveStop('Budapest-Keleti'), liveStop('Szolnok', { cancelled: true })] }));
    expect(res.stops.map((s) => s.cancelled)).toEqual([false, true, false]);
  });

  test('live data for another service date is ignored', () => {
    const res = mergeTrip(trip, liveTrain({ serviceDate: '20261111' }));
    expect(res.live.state).toBe('none');
    expect(res.delayMin).toBeNull();
    expect(res.stops[1]!.arrival!.expected).toBeNull();
  });

  test('no live data', () => {
    const res = mergeTrip(trip, null);
    expect(res.live).toEqual({ state: 'none', fetchedAt: null });
    expect(res.stops[0]!.arrival).toBeNull();
    expect(res.stops[0]!.departure).toEqual({ planned: T('23:30'), expected: null, delayMin: null });
  });
});

describe('safeLive', () => {
  const source = (impl: () => Promise<LiveResult<string>>) =>
    ({ train: impl, departures: impl, status: () => ({}) }) as unknown as LiveSource;

  test('returns the result, or null on no source, error or timeout', async () => {
    const ok = { data: 'x', fetchedAt: FETCHED, stale: false };
    expect(await safeLive(source(async () => ok), (s) => s.departures({ gtfsStopId: 'A', name: 'A' }) as never)).toEqual(ok);
    expect(await safeLive(null, async () => ok)).toBeNull();
    expect(await safeLive(source(async () => { throw new Error('boom'); }), (s) => s.departures({ gtfsStopId: 'A', name: 'A' }) as never)).toBeNull();
    expect(await safeLive(source(() => new Promise(() => {})), (s) => s.departures({ gtfsStopId: 'A', name: 'A' }) as never, 20)).toBeNull();
  });
});
