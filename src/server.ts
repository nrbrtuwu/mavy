import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { registerPasswordAuth } from './auth.ts';
import { DB_PATH } from './gtfs/import.ts';
import { Timetable } from './gtfs/queries.ts';
import type { LiveSource } from './live/types.ts';
import { VonatinfoSource } from './live/vonatinfo.ts';
import { planJourneys } from './gtfs/planner.ts';
import { directIsBetter, isLiveRelevant, liveTrainNumber, mergeConnections, mergeJourney, mergeDepartures, mergeTrip, safeLive } from './merge.ts';
import { parseServiceDate, parseUserTime } from './time.ts';

/** Planned departures this far back are fetched too, so delayed trains still show. */
const LOOKBACK_SEC = 3600;
/** Route results: at most this many train pages fetched for arrival predictions. */
const MAX_ARRIVAL_TRAINS = 3;

/** Built frontend (bun run build writes it from web/). */
export const PUBLIC_DIR = resolve(fileURLToPath(new URL('../dist/public/', import.meta.url)));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** All files under the public dir except sw.js and dotfiles, as URL paths ('icons/icon.svg'). */
async function listPublicFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...(await listPublicFiles(join(dir, entry.name), `${rel}/`)));
    else if (rel !== 'sw.js') out.push(rel);
  }
  return out.sort();
}

/**
 * sw.js with its BUILD line filled in: the precache list and a hash of all
 * public files. Any frontend change gives a new hash, so browsers install a
 * fresh static cache without manual version bumps.
 */
export async function serviceWorkerSource(publicDir = PUBLIC_DIR): Promise<string> {
  const files = await listPublicFiles(publicDir);
  const source = await readFile(join(publicDir, 'sw.js'), 'utf8');
  const hash = createHash('sha256').update(source);
  for (const f of files) hash.update(f).update(await readFile(join(publicDir, f)));
  const build = { version: hash.digest('hex').slice(0, 12), files: ['./', ...files] };
  return source.replace(/^const BUILD = .*; \/\/ @build$/m, `const BUILD = ${JSON.stringify(build)}; // @build`);
}

export interface ServerOptions {
  /** SQLite timetable path (default data/mavy.db). */
  dbPath?: string;
  /** Clock, for tests. */
  now?: () => number;
  /** Live delay source. null/absent = planned times only ("no live data"). */
  live?: LiveSource | null;
  /** Shared password (default: MAVY_PASSWORD env). Empty/null = no password gate. */
  password?: string | null;
  /** Folder with the built frontend (default dist/public). */
  publicDir?: string;
  logger?: boolean;
}

const StationsQuery = z.object({ q: z.string().trim().min(1).max(100) });
const DeparturesQuery = z.object({
  station: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const RouteQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  time: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
const TrainQuery = z.object({ date: z.string().optional() });

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: 'bad_request', message });
}

function parse<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | null {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  badRequest(reply, res.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '));
  return null;
}

export function buildServer(opts: ServerOptions = {}): FastifyInstance {
  const dbPath = opts.dbPath ?? DB_PATH;
  const now = opts.now ?? Date.now;
  const live = opts.live ?? null;
  const publicDir = resolve(opts.publicDir ?? PUBLIC_DIR);
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    // tailscale serve and cloudflared proxy from this machine: trust their
    // X-Forwarded-* headers (client IP, https) only when they come from loopback.
    trustProxy: 'loopback',
  });

  const password = opts.password === undefined ? process.env.MAVY_PASSWORD : opts.password;
  if (password) registerPasswordAuth(app, { password, now });

  // Opened on first use, so the server starts even before the first GTFS import.
  let timetable: Timetable | null = null;
  const getTimetable = (): Timetable | null => {
    if (!timetable && existsSync(dbPath)) timetable = new Timetable(dbPath);
    return timetable;
  };
  app.addHook('onClose', async () => timetable?.close());

  const noTimetable = (reply: FastifyReply) =>
    reply.code(503).send({ error: 'no_timetable', message: 'No timetable imported yet. Run: bun run import-gtfs' });

  app.get('/api/health', async () => {
    const meta = getTimetable()?.meta();
    return {
      ok: true,
      gtfs: meta
        ? {
            importedAt: meta.imported_at ?? null,
            feedStartDate: meta.feed_start_date ?? null,
            feedEndDate: meta.feed_end_date ?? null,
            feedVersion: meta.feed_version ?? null,
          }
        : null,
      live: live ? live.status() : 'not configured',
    };
  });

  app.get('/api/stations', async (req, reply) => {
    const q = parse(StationsQuery, req.query, reply);
    if (!q) return reply;
    const tt = getTimetable();
    if (!tt) return noTimetable(reply);
    return { stations: tt.searchStations(q.q) };
  });

  // Every station, for searching in the browser without a request per keystroke.
  // Changes only with a new GTFS import, so the import time is the ETag: browsers
  // revalidate cheaply (304) and download again only after a re-import.
  let allStations: { etag: string; body: string } | null = null;
  app.get('/api/stations/all', async (req, reply) => {
    const tt = getTimetable();
    if (!tt) return noTimetable(reply);
    const etag = `"stations-${tt.meta().imported_at ?? 'unknown'}"`;
    if (!allStations || allStations.etag !== etag) {
      allStations = { etag, body: JSON.stringify({ stations: tt.allStations() }) };
    }
    reply.header('etag', etag).header('cache-control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(allStations.body);
  });

  app.get('/api/departures', async (req, reply) => {
    const q = parse(DeparturesQuery, req.query, reply);
    if (!q) return reply;
    const tt = getTimetable();
    if (!tt) return noTimetable(reply);
    const t = now();
    // Extra rows: the lookback window adds trains that may already have left.
    const planned = tt.departures(q.station, { now: t, limit: q.limit + 40, lookbackSec: LOOKBACK_SEC });
    if (!planned) return reply.code(404).send({ error: 'unknown_station' });
    const liveBoard = await safeLive(live, (s) =>
      s.departures({ gtfsStopId: planned.station.id, name: planned.station.name }),
    );
    return { station: planned.station, ...mergeDepartures(planned.departures, liveBoard, { now: t, limit: q.limit }) };
  });

  app.get('/api/route', async (req, reply) => {
    const q = parse(RouteQuery, req.query, reply);
    if (!q) return reply;
    const t = now();
    const time = q.time === undefined ? t : parseUserTime(q.time, t);
    if (time === null) return badRequest(reply, 'time: use HH:MM, YYYY-MM-DDTHH:MM or ISO 8601');
    const tt = getTimetable();
    if (!tt) return noTimetable(reply);
    // Live data only for searches around now; a search for later uses planned times.
    const nearNow = Math.abs(time - t) < 2 * 3600 * 1000;
    const start = nearNow ? Math.min(time, t) - LOOKBACK_SEC * 1000 : time;
    const planned = tt.route(q.from, q.to, { time: start, limit: q.limit + 20 });
    if (!planned) return reply.code(404).send({ error: 'unknown_station' });
    if (planned.from.id === planned.to.id) return badRequest(reply, 'from and to are the same station');
    // Two boards: departure station for departures, arrival station for its own predicted arrivals.
    const [liveBoard, arrivalBoard] = nearNow
      ? await Promise.all([
          safeLive(live, (s) => s.departures({ gtfsStopId: planned.from.id, name: planned.from.name })),
          safeLive(live, (s) => s.departures({ gtfsStopId: planned.to.id, name: planned.to.name })),
        ])
      : [null, null];
    const opts = { from: time, limit: q.limit };
    let merged = mergeConnections(planned.connections, liveBoard, opts, arrivalBoard);
    // Boards predict arrivals only for trains close by; for the others, ask the train's
    // own page (a few trains at most, cached like everything else).
    if (merged.needTrains.length > 0) {
      const results = await Promise.all(
        merged.needTrains.slice(0, MAX_ARRIVAL_TRAINS).map((ref) => safeLive(live, (s) => s.train(ref))),
      );
      const trains = results.flatMap((r) => (r?.data ? [r.data] : []));
      if (trains.length > 0) merged = mergeConnections(planned.connections, liveBoard, opts, arrivalBoard, trains);
    }
    // Trips with changes (journey planner), where no direct train is at least as good.
    const withChanges = (planJourneys(tt, q.from, q.to, { time, limit: q.limit }) ?? [])
      .filter((j) => j.legs.length > 1 && !directIsBetter(j, planned.connections))
      .map((j) => mergeJourney(j, liveBoard));
    const connections = [...merged.connections, ...withChanges]
      .sort((a, b) => Date.parse(a.departure.planned) - Date.parse(b.departure.planned))
      .slice(0, q.limit);
    return { from: planned.from, to: planned.to, live: merged.live, connections };
  });

  app.get<{ Params: { tripId: string } }>('/api/train/:tripId', async (req, reply) => {
    const q = parse(TrainQuery, req.query, reply);
    if (!q) return reply;
    let date: string | undefined;
    if (q.date !== undefined) {
      const parsed = parseServiceDate(q.date);
      if (!parsed) return badRequest(reply, 'date: use YYYYMMDD or YYYY-MM-DD');
      date = parsed;
    }
    const tt = getTimetable();
    if (!tt) return noTimetable(reply);
    const t = now();
    const trip = tt.trip(req.params.tripId, { now: t, date });
    if (!trip) return reply.code(404).send({ error: 'unknown_train' });
    const relevant = trip.runsOnDate && isLiveRelevant(trip.serviceDate, t);
    // S/Z/IR trains have no number in MÁV's GTFS: take it from the first station's live board.
    let trainNumber = trip.trainNumber;
    const first = trip.stops[0];
    if (relevant && !trainNumber && first) {
      const board = await safeLive(live, (s) => s.departures({ gtfsStopId: first.stationId, name: first.name }));
      trainNumber = liveTrainNumber(trip, board?.data ?? null);
    }
    const liveTrain =
      relevant && trainNumber
        ? await safeLive(live, (s) => s.train({ tripId: trip.tripId, trainNumber, serviceDate: trip.serviceDate }))
        : null;
    return mergeTrip(trip, liveTrain);
  });

  // Unknown API paths: JSON 404 (not the static handler).
  app.get('/api/*', async (_req, reply) => reply.code(404).send({ error: 'not_found' }));

  // Static files of the built frontend (no extra dependency).
  app.get('/*', async (req, reply) => {
    const urlPath = decodeURIComponent((req.params as { '*': string })['*'] || 'index.html');
    if (urlPath === 'sw.js') {
      return reply.type(MIME['.js']!).header('cache-control', 'no-cache').send(await serviceWorkerSource(publicDir));
    }
    const filePath = resolve(publicDir, urlPath);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const target = (await stat(filePath)).isDirectory() ? join(filePath, 'index.html') : filePath;
      const body = await readFile(target);
      // Vite's assets/ have content hashes in their names: cache them for good.
      const immutable = urlPath.startsWith('assets/');
      return reply
        .type(MIME[extname(target)] ?? 'application/octet-stream')
        .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
        .send(body);
    } catch {
      if (urlPath === 'index.html' && !existsSync(join(publicDir, 'index.html'))) {
        return reply
          .code(503)
          .type('text/plain; charset=utf-8')
          .send('A felulet meg nincs leforditva. Futtasd: bun run build');
      }
      return reply.code(404).send({ error: 'not_found' });
    }
  });

  return app;
}

if (import.meta.main) {
  // Live delays from vonatinfo.mav.hu unless MAVY_LIVE=off.
  const app = buildServer({ live: process.env.MAVY_LIVE === 'off' ? null : new VonatinfoSource() });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  app.listen({ port, host }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
