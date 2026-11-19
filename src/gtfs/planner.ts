// Journey planner: trips from station A to station B with any number of changes, on the
// planned timetable. Connection Scan Algorithm (Dibbelt et al.): every trip's stop-to-stop
// hops sorted by departure. Each option is two scans: forwards for the earliest arrival,
// then backwards for the latest departure that still arrives then (so no option leaves
// earlier than it has to). The next option is searched from just after that departure.
// A change needs MIN_CHANGE_SEC at the same station (any platform); on equal times the
// journey with fewer trains wins.

import { NO_ALIGHTING, NO_BOARDING, type ConnectionGraph, type Station, type Timetable, type TrainInfo, datesCovering } from './queries.ts';
import { serviceDayStart, toIso } from '../time.ts';

/** Minimum time to change trains at a station. */
export const MIN_CHANGE_SEC = 3 * 60;

export interface PlannedLeg extends TrainInfo {
  from: Station;
  to: Station;
  departure: string;
  arrival: string;
  fromPlatform: string | null;
  toPlatform: string | null;
}

export interface PlannedJourney {
  legs: PlannedLeg[];
  departure: string;
  arrival: string;
  durationMin: number;
}

/** Connections of the trips running on the service dates around a time window, in time order. */
interface Window {
  dep: Float64Array; // ms
  arr: Float64Array; // ms
  conn: Int32Array; // index into the graph
  tripRun: Int32Array; // trip index * dates.length + date index (one run of a trip)
  /** Window indexes by arrival, latest first (backward scan). */
  byArrDesc: Int32Array;
  dates: string[];
}

function buildWindow(tt: Timetable, g: ConnectionGraph, from: number, to: number): Window {
  const dates = datesCovering(from, to);
  const parts: { dep: number; arr: number; conn: number; run: number }[] = [];
  dates.forEach((date, di) => {
    const active = tt.activeServices(date).set;
    if (active.size === 0) return;
    const start = serviceDayStart(date);
    const lo = Math.floor((from - start) / 1000);
    const hi = Math.ceil((to - start) / 1000);
    for (let i = lowerBound(g.dep, lo); i < g.dep.length && g.dep[i]! <= hi; i++) {
      if (!active.has(g.trips[g.trip[i]!]!.serviceId)) continue;
      parts.push({ dep: start + g.dep[i]! * 1000, arr: start + g.arr[i]! * 1000, conn: i, run: g.trip[i]! * dates.length + di });
    }
  });
  parts.sort((a, b) => a.dep - b.dep);
  const n = parts.length;
  const w: Window = {
    dep: new Float64Array(n),
    arr: new Float64Array(n),
    conn: new Int32Array(n),
    tripRun: new Int32Array(n),
    byArrDesc: new Int32Array(n),
    dates,
  };
  parts.forEach((p, i) => {
    w.dep[i] = p.dep;
    w.arr[i] = p.arr;
    w.conn[i] = p.conn;
    w.tripRun[i] = p.run;
  });
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => w.arr[y]! - w.arr[x]!);
  w.byArrDesc.set(order);
  return w;
}

function lowerBound(a: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One earliest-arrival search from `start`: the journey's legs as window index pairs, or null. */
function scan(g: ConnectionGraph, w: Window, origin: number, target: number, start: number): { enter: number; exit: number }[] | null {
  const nStations = g.stationIds.length;
  const canBoard = new Float64Array(nStations).fill(Infinity); // earliest time to board a new train here
  const arrival = new Float64Array(nStations).fill(Infinity);
  const legsTo = new Int32Array(nStations).fill(1 << 30); // trains used to get there (ties: fewer wins)
  const enteredAt = new Map<number, number>(); // trip run -> window index where it was boarded
  const runLegs = new Map<number, number>(); // trip run -> trains used including this one
  const legTo = new Map<number, { enter: number; exit: number }>(); // station -> last leg reaching it
  canBoard[origin] = start;
  arrival[origin] = start;
  legsTo[origin] = 0;

  for (let i = lowerBound(w.dep, start); i < w.dep.length; i++) {
    if (arrival[target]! <= w.dep[i]!) break;
    const c = w.conn[i]!;
    const run = w.tripRun[i]!;
    const from = g.from[c]!;
    let entered = enteredAt.get(run);
    if (entered === undefined) {
      if ((g.flags[c]! & NO_BOARDING) !== 0 || canBoard[from]! > w.dep[i]!) continue;
      entered = i;
      enteredAt.set(run, i);
      runLegs.set(run, legsTo[from]! + 1);
    }
    const to = g.to[c]!;
    const legs = runLegs.get(run)!;
    const t = w.arr[i]!;
    // Earlier arrival wins; the same arrival with fewer trains (changes) wins too.
    if ((g.flags[c]! & NO_ALIGHTING) === 0 && (t < arrival[to]! || (t === arrival[to]! && legs < legsTo[to]!))) {
      arrival[to] = t;
      legsTo[to] = legs;
      canBoard[to] = t + MIN_CHANGE_SEC * 1000;
      legTo.set(to, { enter: entered, exit: i });
    }
  }
  if (arrival[target] === Infinity) return null;

  const legs: { enter: number; exit: number }[] = [];
  for (let at = target; at !== origin; ) {
    const leg = legTo.get(at);
    if (!leg || legs.length > 20) return null;
    legs.unshift(leg);
    at = g.from[w.conn[leg.enter]!]!;
  }
  return legs;
}

/**
 * Backward scan: the latest departure from `origin` (not before `notBefore`) that reaches
 * `target` by `deadline`, as legs. Ties: fewer trains.
 */
function scanBack(
  g: ConnectionGraph,
  w: Window,
  origin: number,
  target: number,
  deadline: number,
  notBefore: number,
): { enter: number; exit: number }[] | null {
  const nStations = g.stationIds.length;
  const latestDep = new Float64Array(nStations).fill(-Infinity); // latest boarding here that still makes it
  const legsFrom = new Int32Array(nStations).fill(1 << 30); // trains from here to the target
  const exitOf = new Map<number, { exit: number; legs: number }>(); // trip run -> where to get off
  const legFrom = new Map<number, { enter: number; exit: number }>(); // station -> first leg from it
  const change = MIN_CHANGE_SEC * 1000;

  for (let k = 0; k < w.byArrDesc.length; k++) {
    const i = w.byArrDesc[k]!;
    const arr = w.arr[i]!;
    if (arr > deadline) continue;
    if (arr < latestDep[origin]!) break; // earlier hops cannot give a later departure from origin
    const c = w.conn[i]!;
    const run = w.tripRun[i]!;
    let ex = exitOf.get(run);
    if (ex === undefined) {
      const to = g.to[c]!;
      const ok = to === target ? true : arr + change <= latestDep[to]!;
      if ((g.flags[c]! & NO_ALIGHTING) !== 0 || !ok) continue;
      ex = { exit: i, legs: (to === target ? 0 : legsFrom[to]!) + 1 };
      exitOf.set(run, ex);
    }
    const from = g.from[c]!;
    const dep = w.dep[i]!;
    if ((g.flags[c]! & NO_BOARDING) !== 0 || dep < notBefore || from === target) continue;
    if (dep > latestDep[from]! || (dep === latestDep[from]! && ex.legs < legsFrom[from]!)) {
      latestDep[from] = dep;
      legsFrom[from] = ex.legs;
      legFrom.set(from, { enter: i, exit: ex.exit });
    }
  }
  if (latestDep[origin] === -Infinity) return null;

  const legs: { enter: number; exit: number }[] = [];
  for (let at = origin; at !== target; ) {
    const leg = legFrom.get(at);
    if (!leg || legs.length > 20) return null;
    legs.push(leg);
    at = g.to[w.conn[leg.exit]!]!;
  }
  return legs;
}

function toJourney(tt: Timetable, g: ConnectionGraph, w: Window, legs: { enter: number; exit: number }[]): PlannedJourney {
  const station = (i: number): Station => ({ id: g.stationIds[i]!, name: g.stationNames[i]! });
  const planned = legs.map(({ enter, exit }): PlannedLeg => {
    const ce = w.conn[enter]!;
    const cx = w.conn[exit]!;
    const run = w.tripRun[enter]!;
    const trip = g.trips[g.trip[ce]!]!;
    const date = w.dates[run % w.dates.length]!;
    return {
      ...tt.graphTrainInfo(trip.row, date),
      from: station(g.from[ce]!),
      to: station(g.to[cx]!),
      departure: toIso(w.dep[enter]!),
      arrival: toIso(w.arr[exit]!),
      fromPlatform: g.stopPlatform[g.fromStop[ce]!] ?? null,
      toPlatform: g.stopPlatform[g.toStop[cx]!] ?? null,
    };
  });
  const dep = Date.parse(planned[0]!.departure);
  const arr = Date.parse(planned.at(-1)!.arrival);
  return { legs: planned, departure: planned[0]!.departure, arrival: planned.at(-1)!.arrival, durationMin: Math.round((arr - dep) / 60000) };
}

/**
 * The next journeys from station A to station B leaving at or after `time` (within
 * `windowSec`), earliest arrival first for each departure; a later departure that arrives
 * just as early replaces an earlier one. Direct trains are included (one leg).
 */
export function planJourneys(
  tt: Timetable,
  fromId: string,
  toId: string,
  opts: { time: number; limit?: number; windowSec?: number },
): PlannedJourney[] | null {
  const a = tt.station(fromId);
  const b = tt.station(toId);
  if (!a || !b) return null;
  const g = tt.connectionGraph();
  const origin = g.stationOf.get(a.station.id);
  const target = g.stationOf.get(b.station.id);
  if (origin === undefined || target === undefined || origin === target) return [];
  const limit = opts.limit ?? 10;
  const end = opts.time + (opts.windowSec ?? 24 * 3600) * 1000;
  // Journeys may run long past the last departure considered: 12 h of extra connections.
  const w = buildWindow(tt, g, opts.time, end + 12 * 3600 * 1000);

  // A few more than asked, so an option that a later one beats can be dropped.
  const found: PlannedJourney[] = [];
  let start = opts.time;
  while (found.length < limit + 4 && start <= end) {
    const first = scan(g, w, origin, target, start);
    if (!first) break;
    const arrival = w.arr[first.at(-1)!.exit]!;
    // Same arrival, leaving as late as possible (falls back to the forward result).
    const legs = scanBack(g, w, origin, target, arrival, start) ?? first;
    const j = toJourney(tt, g, w, legs);
    if (Date.parse(j.departure) > end) break;
    found.push(j);
    start = Date.parse(j.departure) + 1000;
  }
  return found.filter((j) => !found.some((k) => beats(k, j))).slice(0, limit);
}

/** k is at least as good as j in departure (later), arrival (earlier) and changes, and better in one. */
export function beats(k: Pick<PlannedJourney, 'departure' | 'arrival'> & { legs: unknown[] }, j: typeof k): boolean {
  const kd = Date.parse(k.departure);
  const jd = Date.parse(j.departure);
  const ka = Date.parse(k.arrival);
  const ja = Date.parse(j.arrival);
  if (kd < jd || ka > ja || k.legs.length > j.legs.length) return false;
  return kd > jd || ka < ja || k.legs.length < j.legs.length;
}
