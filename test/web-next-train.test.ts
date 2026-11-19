// Kedvencek next train.
import { describe, expect, test } from 'bun:test';
import { nextFromBoard, nextFromRoute } from '../web/src/lib/next-train.ts';

const T = (hm: string) => `2026-11-19T${hm}:00+01:00`;
const NOW = Date.parse(T('10:00'));
const time = (planned: string, expected: string | null = null, delayMin: number | null = null) => ({ planned: T(planned), expected: expected && T(expected), delayMin });
const train = { serviceDate: '20261119', trainNumber: null, label: 'S10', headsign: 'Győr', reason: null, cancelled: false };

describe('next train of a favourite', () => {
  test('board: first train not gone, a late one still counts until it leaves', () => {
    const data: any = {
      departures: [
        { ...train, tripId: 'gone', departure: time('09:50'), live: 'live' },
        { ...train, tripId: 'late', departure: time('09:55', '10:02', 7), currentDelayMin: 9, live: 'live' },
        { ...train, tripId: 'later', departure: time('10:20'), live: 'live' },
      ],
    };
    expect(nextFromBoard(data, NOW)).toMatchObject({ departure: { planned: T('09:55') }, headsign: 'Győr', delayMin: 9, live: true });
    expect(nextFromBoard({ ...data, departures: data.departures.slice(0, 1) }, NOW)).toBeNull();
  });

  test('route: departure and arrival, no live data means no delay shown', () => {
    const data: any = { connections: [{ ...train, tripId: 'a', departure: time('10:11'), arrival: time('11:19'), live: 'none' }] };
    expect(nextFromRoute(data, NOW)).toMatchObject({ arrival: { planned: T('11:19') }, delayMin: null, live: false });
  });
});

