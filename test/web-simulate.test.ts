// Simulated delays (design preview, Beállítások > Szimulált késések).
import { describe, expect, test } from 'bun:test';
import { addMinutes, simulateBoard, simulateRoute, simulateRun, simulateTrip } from '../web/src/lib/simulate.ts';
import type { BoardResponse, RouteResponse, Trip } from '../web/src/lib/types.ts';

const T = (hhmm: string, day = '13') => `2026-11-${day}T${hhmm}:00+01:00`;

describe('simulate', () => {
  test('addMinutes keeps the Budapest offset and crosses midnight', () => {
    expect(addMinutes(T('11:32'), 8)).toBe(T('11:40'));
    expect(addMinutes(T('23:55'), 10)).toBe(T('00:05', '14'));
    expect(addMinutes('2026-07-01T08:00:00+02:00', 15)).toBe('2026-07-01T08:15:00+02:00');
  });

  test('same run, same fake delay; values in range', () => {
    expect(simulateRun('36321470_2547.', '20261113')).toEqual(simulateRun('36321470_2547.', '20261113'));
    let late = 0;
    let cancelled = 0;
    for (let i = 0; i < 2000; i++) {
      const run = simulateRun(`trip${i}`, '20261113');
      expect(run.delayMin).toBeGreaterThanOrEqual(0);
      expect(run.delayMin).toBeLessThanOrEqual(25);
      if (run.cancelled) cancelled++;
      else if (run.delayMin > 0) late++;
      if (run.reason) expect(run.reason).toContain('(szimulált)');
    }
    // roughly 5% cancelled, 45% late
    expect(cancelled).toBeGreaterThan(40);
    expect(cancelled).toBeLessThan(200);
    expect(late).toBeGreaterThan(700);
    expect(late).toBeLessThan(1100);
  });

  test('board, route and trip get consistent fake data marked live', () => {
    const tripId = [...Array(200).keys()].map((i) => `t${i}`).find((id) => simulateRun(id, '20261113').delayMin > 0)!;
    const run = simulateRun(tripId, '20261113');
    const base = { tripId, serviceDate: '20261113', trainNumber: '562', label: 'IC 562 TOKAJ', headsign: 'Tata' };
    const board: BoardResponse = {
      station: { id: '267', name: 'Budapest-Keleti' },
      live: { state: 'none', fetchedAt: null },
      departures: [
        { ...base, stopId: '267', platform: null, departure: { planned: T('11:32'), expected: null, delayMin: null }, cancelled: false, reason: null, live: 'none' },
      ],
    };
    const b = simulateBoard(board);
    expect(b.live.state).toBe('live');
    expect(b.departures[0]!.departure).toEqual({ planned: T('11:32'), expected: addMinutes(T('11:32'), run.delayMin), delayMin: run.delayMin });

    const route: RouteResponse = {
      from: { id: '267', name: 'Budapest-Keleti' },
      to: { id: '3652', name: 'Tata' },
      live: { state: 'none', fetchedAt: null },
      connections: [
        {
          ...base,
          departure: { planned: T('11:32'), expected: null, delayMin: null },
          arrival: { planned: T('12:16'), expected: null, delayMin: null },
          durationMin: 44,
          fromPlatform: null,
          toPlatform: null,
          cancelled: false,
          reason: null,
          live: 'none',
        },
      ],
    };
    const c = simulateRoute(route).connections[0]!;
    expect(c.arrival.delayMin).toBe(run.delayMin);
    expect(c.arrival.expected).toBe(addMinutes(T('12:16'), run.delayMin));

    const trip: Trip = {
      ...base,
      runsOnDate: true,
      cancelled: false,
      delayMin: null,
      reason: null,
      live: { state: 'none', fetchedAt: null },
      stops: [
        { sequence: 1, stopId: '267', stationId: '267', name: 'Budapest-Keleti', platform: null, arrival: null, departure: { planned: T('11:32'), expected: null, delayMin: null }, cancelled: false, passed: null },
      ],
    };
    const t = simulateTrip(trip);
    expect(t.delayMin).toBe(run.delayMin);
    expect(t.stops[0]!.arrival).toBeNull();
    expect(t.stops[0]!.departure!.delayMin).toBe(run.delayMin);
  });
});
