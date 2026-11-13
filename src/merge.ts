// Planned (GTFS) + live -> what the UI shows.
//
// Matching: GTFS trip_id + service date first (what GTFS-RT uses), then train
// number + service date. Every train always has its planned time; expected
// time and delay are null when there is no live data for it ("no live data").

import { normalizeName } from './gtfs/import.ts';
import type { PlannedConnection, PlannedDeparture, PlannedStop, PlannedTrip, TrainInfo } from './gtfs/queries.ts';
import type { LiveBoard, LiveDeparture, LiveResult, LiveSource, LiveStop, LiveTrain } from './live/types.ts';
import { addDays, localDate, toIso } from './time.ts';

/** live = fresh live data, stale = last good copy (upstream failing), none = no live data. */
export type LiveState = 'live' | 'stale' | 'none';

export interface LiveInfo {
  state: LiveState;
  fetchedAt: string | null;
}

export interface TimeInfo {
  planned: string;
  /** null = no live estimate. */
  expected: string | null;
  /** expected - planned in whole minutes; null = unknown. */
  delayMin: number | null;
}

export interface MergedDeparture extends TrainInfo {
  stopId: string;
  platform: string | null;
  departure: TimeInfo;
  cancelled: boolean;
  /** Delay or cancellation reason from the live source, null if none. */
  reason: string | null;
  live: LiveState;
}

export interface MergedConnection extends TrainInfo {
  departure: TimeInfo;
  /** Expected arrival = live estimate at departure; delay carried over from the departure station. */
  arrival: TimeInfo;
  durationMin: number;
  fromPlatform: string | null;
  toPlatform: string | null;
  cancelled: boolean;
  reason: string | null;
  live: LiveState;
}

export interface MergedStop {
  sequence: number;
  stopId: string;
  stationId: string;
  name: string;
  platform: string | null;
  arrival: TimeInfo | null;
  departure: TimeInfo | null;
  cancelled: boolean;
  passed: boolean | null;
}

export interface MergedTrip extends TrainInfo {
  runsOnDate: boolean;
  cancelled: boolean;
  /** Current delay of the train as a whole, if the source gives one. */
  delayMin: number | null;
  reason: string | null;
  live: LiveInfo;
  stops: MergedStop[];
}

// ---------------------------------------------------------------- helpers

export function liveInfo(result: LiveResult<unknown> | null): LiveInfo {
  if (!result || result.data === null) return { state: 'none', fetchedAt: result?.fetchedAt ?? null };
  return { state: result.stale ? 'stale' : 'live', fetchedAt: result.fetchedAt };
}

/** "519 TOKAJ InterCity" -> "519", "IC 0600" -> "600". */
export function trainNumberKey(value: string | null): string | null {
  if (!value) return null;
  const m = /\d+/.exec(value);
  return m ? m[0].replace(/^0+(?=\d)/, '') : value.trim().toLowerCase();
}

/** Planned time plus live estimate. A live expected time wins; else a live delay is applied. */
export function timeInfo(planned: string, expected: string | null, delayMin: number | null): TimeInfo {
  if (expected !== null) {
    return { planned, expected, delayMin: Math.round((Date.parse(expected) - Date.parse(planned)) / 60000) };
  }
  if (delayMin !== null) {
    return { planned, expected: toIso(Date.parse(planned) + delayMin * 60000), delayMin };
  }
  return { planned, expected: null, delayMin: null };
}

const noLive = (planned: string): TimeInfo => ({ planned, expected: null, delayMin: null });

interface LiveKeyed {
  tripId: string | null;
  trainNumber: string;
  serviceDate: string | null;
}

/** Find the live entry for a planned train. Each live entry is used at most once. */
function findLive<T extends LiveKeyed>(
  entries: T[],
  used: Set<T>,
  train: TrainInfo,
  plannedTime: string,
  livePlannedTime: (e: T) => string | null,
): T | undefined {
  const dateOk = (e: T) => e.serviceDate === null || e.serviceDate === train.serviceDate;
  const byTrip = entries.find((e) => !used.has(e) && e.tripId !== null && e.tripId === train.tripId && dateOk(e));
  if (byTrip) return byTrip;
  const key = trainNumberKey(train.trainNumber);
  if (key === null) return undefined;
  return entries.find((e) => {
    if (used.has(e) || trainNumberKey(e.trainNumber) !== key) return false;
    if (e.serviceDate !== null) return e.serviceDate === train.serviceDate;
    // No service date from the source: require the same planned time.
    const t = livePlannedTime(e);
    return t !== null && Date.parse(t) === Date.parse(plannedTime);
  });
}

// ---------------------------------------------------------------- boards

/**
 * Departure board. `planned` should include a lookback (e.g. 60 min) so delayed
 * trains still waiting at the station are shown. Trains whose expected (or, without
 * live data, planned) departure is more than a minute in the past are dropped.
 */
export function mergeDepartures(
  planned: PlannedDeparture[],
  live: LiveResult<LiveBoard | null> | null,
  opts: { now: number; limit: number },
): { live: LiveInfo; departures: MergedDeparture[] } {
  const info = liveInfo(live);
  const entries = live?.data?.departures ?? [];
  const used = new Set<LiveDeparture>();

  const merged = planned.map((p): MergedDeparture => {
    const l = findLive(entries, used, p, p.departure, (e) => e.plannedDeparture);
    if (!l) return { ...p, departure: noLive(p.departure), cancelled: false, reason: null, live: 'none' };
    used.add(l);
    return {
      ...p,
      platform: l.platform ?? p.platform,
      departure: l.cancelled ? noLive(p.departure) : timeInfo(p.departure, l.expectedDeparture, l.delayMin),
      cancelled: l.cancelled,
      reason: l.reason,
      live: info.state,
    };
  });

  const cutoff = opts.now - 60_000;
  const departures = merged
    .filter((d) => Date.parse(d.cancelled ? d.departure.planned : (d.departure.expected ?? d.departure.planned)) >= cutoff)
    .slice(0, opts.limit);
  return { live: info, departures };
}

/** Route results, using the live board of the departure station (one upstream request). */
export function mergeConnections(
  planned: PlannedConnection[],
  live: LiveResult<LiveBoard | null> | null,
  opts: { from: number; limit: number },
): { live: LiveInfo; connections: MergedConnection[] } {
  const info = liveInfo(live);
  const entries = live?.data?.departures ?? [];
  const used = new Set<LiveDeparture>();

  const merged = planned.map((p): MergedConnection => {
    const l = findLive(entries, used, p, p.departure, (e) => e.plannedDeparture);
    if (!l) {
      return { ...p, departure: noLive(p.departure), arrival: noLive(p.arrival), cancelled: false, reason: null, live: 'none' };
    }
    used.add(l);
    const departure = l.cancelled ? noLive(p.departure) : timeInfo(p.departure, l.expectedDeparture, l.delayMin);
    return {
      ...p,
      fromPlatform: l.platform ?? p.fromPlatform,
      departure,
      arrival: l.cancelled ? noLive(p.arrival) : timeInfo(p.arrival, null, departure.delayMin),
      cancelled: l.cancelled,
      reason: l.reason,
      live: info.state,
    };
  });

  const cutoff = opts.from - 60_000;
  const connections = merged
    .filter((c) => Date.parse(c.cancelled ? c.departure.planned : (c.departure.expected ?? c.departure.planned)) >= cutoff)
    .slice(0, opts.limit);
  return { live: info, connections };
}

// ---------------------------------------------------------------- train detail

/** Live stops matched to planned stops in order: by stop id, else by accent-free name. */
function matchStops(planned: PlannedStop[], live: LiveStop[]): (LiveStop | undefined)[] {
  let cursor = 0;
  return planned.map((p) => {
    const name = normalizeName(p.name);
    for (let i = cursor; i < live.length; i++) {
      const l = live[i]!;
      const idMatch = l.stationCode !== null && (l.stationCode === p.stopId || l.stationCode === p.stationId);
      if (idMatch || normalizeName(l.stationName) === name) {
        cursor = i + 1;
        return l;
      }
    }
    return undefined;
  });
}

export function mergeTrip(planned: PlannedTrip, live: LiveResult<LiveTrain | null> | null): MergedTrip {
  const train = live?.data ?? null;
  const usable = train !== null && train.serviceDate === planned.serviceDate;
  const info: LiveInfo = usable ? liveInfo(live) : { state: 'none', fetchedAt: live?.fetchedAt ?? null };
  const liveStops = usable ? matchStops(planned.stops, train.stops) : [];
  const cancelled = usable && train.cancelled;
  // Stops without their own estimate get the train's current delay, unless already passed.
  const fallbackDelay = usable && !cancelled ? train.delayMin : null;

  const stops = planned.stops.map((p, i): MergedStop => {
    const l = liveStops[i];
    const stopCancelled = cancelled || (l?.cancelled ?? false);
    const delay = l?.passed === true ? null : fallbackDelay;
    const time = (plannedTime: string | null, expected: string | null | undefined): TimeInfo | null => {
      if (plannedTime === null) return null;
      if (!usable || stopCancelled) return noLive(plannedTime);
      return timeInfo(plannedTime, expected ?? null, delay);
    };
    return {
      sequence: p.sequence,
      stopId: p.stopId,
      stationId: p.stationId,
      name: p.name,
      platform: l?.platform ?? p.platform,
      arrival: time(p.arrival, l?.expectedArrival),
      departure: time(p.departure, l?.expectedDeparture),
      cancelled: stopCancelled,
      passed: l?.passed ?? null,
    };
  });

  return {
    tripId: planned.tripId,
    serviceDate: planned.serviceDate,
    trainNumber: planned.trainNumber,
    label: planned.label,
    headsign: planned.headsign,
    runsOnDate: planned.runsOnDate,
    cancelled,
    delayMin: usable ? train.delayMin : null,
    reason: usable ? train.reason : null,
    live: info,
    stops,
  };
}

// ---------------------------------------------------------------- fetching

/** Live data only makes sense for runs from yesterday (past midnight) to today. */
export function isLiveRelevant(serviceDate: string, now: number): boolean {
  const today = localDate(now);
  return serviceDate >= addDays(today, -1) && serviceDate <= today;
}

/**
 * Call the live source and never fail: no source, an error or a slow answer
 * (timeout) all mean "no live data". The live cache keeps the upstream status.
 */
export async function safeLive<T>(
  source: LiveSource | null,
  call: (s: LiveSource) => Promise<LiveResult<T>>,
  timeoutMs = 4000,
): Promise<LiveResult<T> | null> {
  if (!source) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(source),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
