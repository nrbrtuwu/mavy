import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGtfs } from '../src/gtfs/import.ts';
import { buildServer } from '../src/server.ts';
import { makePublicDir } from './helpers.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'gtfs');
const NOW = Date.parse('2026-11-12T06:00:00+01:00'); // Thursday morning, Budapest
let tmp: string;
let app: FastifyInstance;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mavy-srv-'));
  await importGtfs(FIXTURE, join(tmp, 'srv.db'));
  app = buildServer({ dbPath: join(tmp, 'srv.db'), now: () => NOW, publicDir: makePublicDir(), logger: false });
});
afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('server without timetable', () => {
  it('health works, data endpoints answer 503', async () => {
    const empty = buildServer({ dbPath: join(tmpdir(), 'mavy-does-not-exist.db'), logger: false });
    const health = await empty.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toMatchObject({ ok: true, gtfs: null });
    const res = await empty.inject({ method: 'GET', url: '/api/stations?q=gyor' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('no_timetable');
    await empty.close();
  });
});

describe('api', () => {
  it('/api/health shows the feed dates', async () => {
    const res = await get('/api/health');
    expect(res.json().gtfs).toMatchObject({ feedStartDate: '20261101', feedEndDate: '20261231', feedVersion: 'test-1' });
  });

  it('/api/stations', async () => {
    expect((await get('/api/stations?q=gy%C5%91r')).json()).toEqual({ stations: [{ id: 'GYOR', name: 'Győr' }] });
    expect((await get('/api/stations')).statusCode).toBe(400);
    expect((await get('/api/stations?q=%20')).statusCode).toBe(400);
  });

  it('/api/stations/all: every top-level station, revalidated with an ETag', async () => {
    const res = await get('/api/stations/all');
    expect(res.statusCode).toBe(200);
    expect(res.json().stations.map((s: { id: string }) => s.id)).toEqual(['BPK', 'DEB', 'GYOR', 'SZOL']);
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^"stations-/);
    expect(res.headers['cache-control']).toBe('no-cache');
    const again = await app.inject({ method: 'GET', url: '/api/stations/all', headers: { 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
  });

  it('/api/departures', async () => {
    const res = await get('/api/departures?station=BPK&limit=2');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.station).toEqual({ id: 'BPK', name: 'Budapest-Keleti' });
    expect(body.departures.map((d: { trainNumber: string }) => d.trainNumber)).toEqual(['6212', '6214']);
    expect((await get('/api/departures?station=NOPE')).statusCode).toBe(404);
    expect((await get('/api/departures?station=BPK&limit=0')).statusCode).toBe(400);
    expect((await get('/api/departures')).statusCode).toBe(400);
  });

  it('/api/route', async () => {
    const res = await get('/api/route?from=BPK&to=DEB&time=13:00');
    expect(res.statusCode).toBe(200);
    expect(res.json().connections.map((c: { trainNumber: string }) => c.trainNumber)).toEqual(['6299', '6212', '6214']);
    expect((await get('/api/route?from=BPK&to=DEB&time=later')).statusCode).toBe(400);
    expect((await get('/api/route?from=BPK&to=BPK_1')).statusCode).toBe(400);
    expect((await get('/api/route?from=BPK&to=NOPE')).statusCode).toBe(404);
  });

  it('/api/train/:tripId', async () => {
    const res = await get('/api/train/T4?date=2026-11-12');
    expect(res.statusCode).toBe(200);
    expect(res.json().stops.at(-1).arrival).toEqual({ planned: '2026-11-13T02:05:00+01:00', expected: null, delayMin: null });
    expect(res.json().live).toEqual({ state: 'none', fetchedAt: null });
    expect((await get('/api/train/T4?date=2026-02-30')).statusCode).toBe(400);
    expect((await get('/api/train/NOPE')).statusCode).toBe(404);
  });

  it('unknown /api path is a JSON 404', async () => {
    const res = await get('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});

describe('static files', () => {
  it('serves index.html and blocks path traversal', async () => {
    const index = await get('/');
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('Mávy');
    expect((await get('/..%2Fpackage.json')).statusCode).toBe(404);
  });

  it('hashed assets are cached for good, other files revalidate', async () => {
    expect((await get('/assets/index-abc123.js')).headers['cache-control']).toContain('immutable');
    expect((await get('/')).headers['cache-control']).toBe('no-cache');
  });

  it('says how to build when the frontend is missing', async () => {
    const bare = buildServer({ dbPath: join(tmp, 'srv.db'), publicDir: join(tmp, 'no-build'), logger: false });
    const res = await bare.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('bun run build');
    await bare.close();
  });
});
