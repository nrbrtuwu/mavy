// Planned (GTFS) + live -> what the UI shows.
//
// Matching: GTFS trip_id + service date first (what GTFS-RT uses), then train
// number + service date. Every train always has its planned time; expected
// time and delay are null when there is no live data for it ("no live data").

import { normalizeName } from './gtfs/import.ts';
import type { PlannedJourney, PlannedLeg } from './gtfs/planner.ts';
import type { PlannedConnection, PlannedDeparture, PlannedStop, PlannedTrip, TrainInfo } from './gtfs/queries.ts';
import type { LiveArrival, LiveBoard, LiveDeparture, LiveResult, LiveSource, LiveStop, LiveTrain, TrainRef } from './live/types.ts';
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
  /** "+N perc": the train's current delay when the source states it, else the departure delay. */
  currentDelayMin: number | null;
  cancelled: boolean;
  /** Delay or cancellation reason from the live source, null if none. */
  reason: string | null;
  live: LiveState;
}

/** One train of a trip with changes (planned times; see mergeJourney). */
export interface MergedLeg extends Omit<PlannedLeg, 'departure' | 'arrival'> {
  departure: TimeInfo;
  arrival: TimeInfo;
}

export interface MergedConnection extends TrainInfo {
  departure: TimeInfo;
  /** Expected arrival: the source's prediction at the arrival station, else the departure delay carried over. */
  arrival: TimeInfo;
  durationMin: number;
  /** "+N perc": the train's current delay when the source states it, else the departure delay. */
  currentDelayMin: number | null;
  fromPlatform: string | null;
  toPlatform: string | null;
  cancelled: boolean;
  reason: string | null;
  live: LiveState;
  /** Trips with changes: every train, in order (absent for a direct train). */
  legs?: MergedLeg[];
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

/** What "+N perc" shows for a row: the source's current delay, else the delay at this station. */
function currentDelay(l: LiveDeparture, departure: TimeInfo): number | null {
  if (l.cancelled) return null;
  return l.currentDelayMin ?? departure.delayMin;
}

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
  if (key === null) return byTimeAndDestination(entries, used, train, plannedTime, livePlannedTime);
  return entries.find((e) => {
    if (used.has(e) || trainNumberKey(e.trainNumber) !== key) return false;
    if (e.serviceDate !== null) return e.serviceDate === train.serviceDate;
    // No service date from the source: require the same planned time.
    const t = livePlannedTime(e);
    return t !== null && Date.parse(t) === Date.parse(plannedTime);
  });
}

/**
 * Trains without a number in the timetable (MÁV's GTFS leaves it out for S/Z/IR lines):
 * same planned time at this station and same destination, and only if exactly one
 * live entry fits, so two trains leaving in the same minute are never mixed up.
 */
function byTimeAndDestination<T extends LiveKeyed>(
  entries: T[],
  used: Set<T>,
  train: TrainInfo,
  plannedTime: string,
  livePlannedTime: (e: T) => string | null,
): T | undefined {
  if (!train.headsign) return undefined;
  const dest = normalizeName(train.headsign);
  const at = Date.parse(plannedTime);
  const fits = entries.filter((e) => {
    const t = livePlannedTime(e);
    const d = 'destination' in e && typeof e.destination === 'string' ? normalizeName(e.destination) : null;
    return t !== null && Date.parse(t) === at && d === dest && (e.serviceDate === null || e.serviceDate === train.serviceDate);
  });
  return fits.length === 1 && !used.has(fits[0]!) ? fits[0] : undefined;
}

/**
 * The live train number of a trip without one in the timetable (S/Z/IR lines): found on
 * its first station's board by planned departure and destination, only if exactly one fits.
 */
export function liveTrainNumber(trip: PlannedTrip, board: LiveBoard | null): string | null {
  const first = trip.stops[0];
  if (!board || !first?.departure) return null;
  return byTimeAndDestination(board.departures, new Set(), trip, first.departure, (e) => e.plannedDeparture)?.trainNumber ?? null;
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
    if (!l) return { ...p, departure: noLive(p.departure), currentDelayMin: null, cancelled: false, reason: null, live: 'none' };
    used.add(l);
    const departure = l.cancelled ? noLive(p.departure) : timeInfo(p.departure, l.expectedDeparture, l.delayMin);
    return {
      ...p,
      platform: l.platform ?? p.platform,
      departure,
      currentDelayMin: currentDelay(l, departure),
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

/**
 * Route results, using the live board of the departure station and, when given, of the
 * arrival station. The arrival time is the arrival station's own prediction for the same
 * train (number + service date + planned arrival); without one, the departure delay is
 * carried over.
 */
export function mergeConnections(
  planned: PlannedConnection[],
  live: LiveResult<LiveBoard | null> | null,
  opts: { from: number; limit: number },
  arrivalBoard: LiveResult<LiveBoard | null> | null = null,
  trains: LiveTrain[] = [],
): { live: LiveInfo; connections: MergedConnection[]; needTrains: TrainRef[] } {
  const info = liveInfo(live);
  const entries = live?.data?.departures ?? [];
  const arrivals = arrivalBoard?.data?.arrivals ?? [];
  const used = new Set<LiveDeparture>();
  const missing = new Map<MergedConnection, TrainRef>();

  const merged = planned.map((p): MergedConnection => {
    const l = findLive(entries, used, p, p.departure, (e) => e.plannedDeparture);
    if (!l) {
      return {
        ...p,
        departure: noLive(p.departure),
        arrival: noLive(p.arrival),
        currentDelayMin: null,
        cancelled: false,
        reason: null,
        live: 'none',
      };
    }
    used.add(l);
    const departure = l.cancelled ? noLive(p.departure) : timeInfo(p.departure, l.expectedDeparture, l.delayMin);
    const a = l.cancelled ? undefined : findArrival(arrivals, l, p.arrival);
    // Arrival prediction: the arrival station's board, else the train's own page
    // (boards only predict trains that are close), else the departure delay carried over.
    const predicted = a?.expectedArrival ?? (l.cancelled ? null : trainPrediction(trains, l, p.arrival));
    const c: MergedConnection = {
      ...p,
      fromPlatform: l.platform ?? p.fromPlatform,
      toPlatform: a?.platform ?? p.toPlatform,
      departure,
      arrival: l.cancelled
        ? noLive(p.arrival)
        : predicted
          ? timeInfo(p.arrival, predicted, null)
          : timeInfo(p.arrival, null, departure.delayMin),
      currentDelayMin: currentDelay(l, departure),
      cancelled: l.cancelled,
      reason: l.reason,
      live: info.state,
    };
    if (!l.cancelled && !predicted) {
      missing.set(c, { tripId: p.tripId, trainNumber: l.trainNumber, serviceDate: l.serviceDate ?? p.serviceDate });
    }
    return c;
  });

  const cutoff = opts.from - 60_000;
  const connections = merged
    .filter((c) => Date.parse(c.cancelled ? c.departure.planned : (c.departure.expected ?? c.departure.planned)) >= cutoff)
    .slice(0, opts.limit);
  const needTrains = connections.flatMap((c) => (missing.has(c) ? [missing.get(c)!] : []));
  return { live: info, connections, needTrains };
}

/** The train page's predicted arrival at the stop with this planned arrival. */
function trainPrediction(trains: LiveTrain[], dep: LiveDeparture, plannedArrival: string): string | null {
  const key = trainNumberKey(dep.trainNumber);
  const at = Date.parse(plannedArrival);
  const t = trains.find((x) => trainNumberKey(x.trainNumber) === key && (dep.serviceDate === null || x.serviceDate === dep.serviceDate));
  const stop = t?.stops.find((s) => s.plannedArrival !== null && Date.parse(s.plannedArrival) === at);
  return stop?.expectedArrival ?? null;
}

/** The same run at the arrival station: live train number (known also for S/Z/IR trains) + date + planned time. */
function findArrival(arrivals: LiveArrival[], dep: LiveDeparture, plannedArrival: string): LiveArrival | undefined {
  const key = trainNumberKey(dep.trainNumber);
  const at = Date.parse(plannedArrival);
  return arrivals.find(
    (a) =>
      trainNumberKey(a.trainNumber) === key &&
      (a.serviceDate === null || dep.serviceDate === null || a.serviceDate === dep.serviceDate) &&
      Date.parse(a.plannedArrival) === at,
  );
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

// ---------------------------------------------------------------- trips with changes

/**
 * A trip with changes from the journey planner. The first train gets live data from the
 * departure station's board (like a direct train); the others keep planned times, because
 * live data for every change station would mean more upstream requests.
 */
export function mergeJourney(j: PlannedJourney, live: LiveResult<LiveBoard | null> | null): MergedConnection {
  const first = j.legs[0]!;
  const last = j.legs.at(-1)!;
  const firstAsConnection: PlannedConnection = {
    tripId: first.tripId,
    serviceDate: first.serviceDate,
    trainNumber: first.trainNumber,
    label: first.label,
    headsign: first.headsign,
    departure: first.departure,
    arrival: first.arrival,
    durationMin: Math.round((Date.parse(first.arrival) - Date.parse(first.departure)) / 60000),
    fromPlatform: first.fromPlatform,
    toPlatform: first.toPlatform,
  };
  const m = mergeConnections([firstAsConnection], live, { from: 0, limit: 1 }).connections[0]!;
  return {
    ...m,
    arrival: noLive(j.arrival),
    durationMin: j.durationMin,
    toPlatform: last.toPlatform,
    legs: j.legs.map((l) => ({ ...l, departure: noLive(l.departure), arrival: noLive(l.arrival) })),
  };
}

/** A direct train leaving no earlier and arriving no later makes a trip with changes pointless. */
export function directIsBetter(j: PlannedJourney, direct: PlannedConnection[]): boolean {
  const dep = Date.parse(j.departure);
  const arr = Date.parse(j.arrival);
  return direct.some((d) => Date.parse(d.departure) >= dep && Date.parse(d.arrival) <= arr);
}
