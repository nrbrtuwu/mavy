// Endpoints with a fake live source: delays merged in, failures fall back to planned times.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGtfs } from '../src/gtfs/import.ts';
import type { LiveBoard, LiveResult, LiveSource, LiveStatus, LiveTrain, StationRef, TrainRef } from '../src/live/types.ts';
import { buildServer } from '../src/server.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'gtfs');
const NOW = Date.parse('2026-11-12T06:55:00+01:00'); // T1 (6212) leaves Keleti at 07:00
const FETCHED = '2026-11-12T05:54:40.000Z';
let tmp: string;
let dbPath: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mavy-live-'));
  dbPath = join(tmp, 'live.db');
  await importGtfs(FIXTURE, dbPath);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const status: LiveStatus = { state: 'ok', lastSuccessAt: FETCHED, lastErrorAt: null, lastError: null, retryAt: null, cachedEntries: 1 };

class FakeLive implements LiveSource {
  calls: string[] = [];
  constructor(private readonly fail = false) {}
  async departures(station: StationRef): Promise<LiveResult<LiveBoard | null>> {
    this.calls.push(`departures:${station.gtfsStopId}`);
    if (this.fail) throw new Error('upstream down');
    return {
      data: {
        stationCode: null,
        stationName: station.name,
        departures: [
          {
            tripId: 'T1',
            trainNumber: '6212',
            serviceDate: '20261112',
            destination: 'Debrecen',
            plannedDeparture: '2026-11-12T07:00:00+01:00',
            expectedDeparture: '2026-11-12T07:07:00+01:00',
            delayMin: 7,
            platform: '4',
            cancelled: false,
            reason: 'Pályakarbantartás',
          },
        ],
      },
      fetchedAt: FETCHED,
      stale: false,
    };
  }
  async train(ref: TrainRef): Promise<LiveResult<LiveTrain | null>> {
    this.calls.push(`train:${ref.tripId}:${ref.serviceDate}`);
    if (this.fail) throw new Error('upstream down');
    return {
      data: { tripId: ref.tripId, trainNumber: '6212', serviceDate: ref.serviceDate, cancelled: false, delayMin: 7, reason: 'Pályakarbantartás', stops: [] },
      fetchedAt: FETCHED,
      stale: false,
    };
  }
  status(): LiveStatus {
    return status;
  }
}

async function withServer(live: LiveSource, fn: (get: (url: string) => Promise<{ statusCode: number; json: () => any }>) => Promise<void>) {
  const app = buildServer({ dbPath, now: () => NOW, live, logger: false });
  try {
    await fn((url) => app.inject({ method: 'GET', url }));
  } finally {
    await app.close();
  }
}

describe('with live data', () => {
  it('departures carry expected time, delay and live platform', async () => {
    await withServer(new FakeLive(), async (get) => {
      const body = (await get('/api/departures?station=BPK&limit=3')).json();
      expect(body.live).toEqual({ state: 'live', fetchedAt: FETCHED });
      expect(body.departures[0]).toMatchObject({
        trainNumber: '6212',
        platform: '4',
        departure: { planned: '2026-11-12T07:00:00+01:00', expected: '2026-11-12T07:07:00+01:00', delayMin: 7 },
        cancelled: false,
        reason: 'Pályakarbantartás',
        live: 'live',
      });
      expect(body.departures[1]).toMatchObject({ trainNumber: '6214', live: 'none', departure: { expected: null } });
    });
  });

  it('route near now uses the departure station board', async () => {
    const live = new FakeLive();
    await withServer(live, async (get) => {
      const body = (await get('/api/route?from=BPK&to=DEB')).json();
      expect(body.connections[0]).toMatchObject({
        trainNumber: '6212',
        arrival: { planned: '2026-11-12T09:50:00+01:00', expected: '2026-11-12T09:57:00+01:00', delayMin: 7 },
      });
      expect(live.calls).toEqual(['departures:BPK']);
    });
  });

  it('route for later today uses planned times and does not call upstream', async () => {
    const live = new FakeLive();
    await withServer(live, async (get) => {
      const body = (await get('/api/route?from=BPK&to=DEB&time=20:00')).json();
      expect(body.live.state).toBe('none');
      expect(live.calls).toEqual([]);
    });
  });

  it('train detail asks the live source only for runs from yesterday to today', async () => {
    const live = new FakeLive();
    await withServer(live, async (get) => {
      const today = (await get('/api/train/T1?date=20261112')).json();
      expect(today.live.state).toBe('live');
      expect(today.delayMin).toBe(7);
      expect(today.reason).toBe('Pályakarbantartás');
      const later = (await get('/api/train/T1?date=20261120')).json();
      expect(later.live.state).toBe('none');
      expect(live.calls).toEqual(['train:T1:20261112']);
    });
  });

  it('health shows the live status', async () => {
    await withServer(new FakeLive(), async (get) => {
      expect((await get('/api/health')).json().live).toEqual(status);
    });
  });
});

describe('when the live source fails', () => {
  it('every endpoint still answers with planned times and state none', async () => {
    await withServer(new FakeLive(true), async (get) => {
      const dep = await get('/api/departures?station=BPK&limit=3');
      expect(dep.statusCode).toBe(200);
      expect(dep.json().live.state).toBe('none');
      expect(dep.json().departures[0].departure).toEqual({ planned: '2026-11-12T07:00:00+01:00', expected: null, delayMin: null });

      const train = await get('/api/train/T1?date=20261112');
      expect(train.statusCode).toBe(200);
      expect(train.json().live.state).toBe('none');
    });
  });
});
