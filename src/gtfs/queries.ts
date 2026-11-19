// Planned-data queries on the GTFS SQLite database (built by import.ts).
// All returned times are ISO 8601 strings with the Budapest offset.

import { Database, type Statement } from 'bun:sqlite';
import { normalizeName } from './import.ts';
import { addDays, localDate, serviceDayStart, toIso, weekdayIndex } from '../time.ts';

const DAY_COLUMNS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export interface Station {
  id: string;
  name: string;
}

export interface TrainInfo {
  tripId: string;
  serviceDate: string; // YYYYMMDD
  /** Digits only, e.g. '562'. Used to match live data. null when the feed has no number (suburban lines). */
  trainNumber: string | null;
  /** What to show: 'IC 562 TOKAJ', 'Sz 359', 'S80', 'IR85 MÁTRA'. */
  label: string | null;
  headsign: string | null;
}

export interface PlannedDeparture extends TrainInfo {
  stopId: string;
  platform: string | null;
  departure: string;
}

export interface PlannedConnection extends TrainInfo {
  departure: string;
  arrival: string;
  durationMin: number;
  fromPlatform: string | null;
  toPlatform: string | null;
}

export interface PlannedStop {
  sequence: number;
  stopId: string;
  stationId: string;
  name: string;
  platform: string | null;
  arrival: string | null; // null at the first stop
  departure: string | null; // null at the last stop
}

export interface PlannedTrip extends TrainInfo {
  runsOnDate: boolean;
  stops: PlannedStop[];
}

export interface TrainRow {
  trip_id: string;
  trip_short_name: string | null;
  trip_headsign: string | null;
  route_short_name: string | null;
  route_long_name: string | null;
  last_stop_name: string | null;
}

// The station queries use CROSS JOIN to pin the join order: SQLite cannot
// estimate json_each() sizes and otherwise scans every trip. Starting from
// json_each(stop ids) -> stop_times uses idx_stop_times_stop (stop_id, departure_time).

// Shared SELECT pieces for train info.
const TRAIN_COLUMNS = `
  t.trip_id, t.trip_short_name, t.trip_headsign, r.route_short_name, r.route_long_name,
  (SELECT ls.stop_name FROM stop_times l JOIN stops ls ON ls.stop_id = l.stop_id
    WHERE l.trip_id = t.trip_id ORDER BY l.stop_sequence DESC LIMIT 1) AS last_stop_name`;

/**
 * Train number and display label from the GTFS name fields.
 *
 * The MÁV feed has no trip_short_name. Long-distance and regional trains carry
 * category, number and name in route_long_name ('IC 562 TOKAJ', 'Sz 359',
 * 'Pótló 5267', '39830 '); suburban lines only a line code in route_short_name
 * ('S80'), sometimes with a name in route_long_name ('IR85' + 'MÁTRA').
 * Other feeds that use trip_short_name for the number work too.
 */
export function describeTrain(row: {
  trip_short_name: string | null;
  route_short_name: string | null;
  route_long_name: string | null;
}): { trainNumber: string | null; label: string | null } {
  const clean = (s: string | null) => s?.replace(/\s+/g, ' ').trim() || null;
  const tripShort = clean(row.trip_short_name);
  const short = clean(row.route_short_name);
  const long = clean(row.route_long_name);
  const trainNumber =
    tripShort?.match(/\d+/)?.[0] ?? long?.split(' ').find((word) => /^\d+$/.test(word)) ?? null;
  // Skip trip_short_name when the long name already contains it ('IC 600' in 'IC 600 KŐRÖS').
  const parts = [short, tripShort && long?.includes(tripShort) ? null : tripShort, long];
  return { trainNumber, label: parts.filter(Boolean).join(' ') || null };
}

function trainInfo(row: TrainRow, serviceDate: string): TrainInfo {
  return {
    tripId: row.trip_id,
    serviceDate,
    ...describeTrain(row),
    headsign: row.trip_headsign ?? row.last_stop_name,
  };
}

/** Service dates whose trips can have times inside [from, to]. Trips run up to ~48h after day start. */
export function datesCovering(from: number, to: number): string[] {
  const dates: string[] = [];
  const last = localDate(to);
  for (let d = addDays(localDate(from), -1); d <= last; d = addDays(d, 1)) dates.push(d);
  return dates;
}

export const NO_BOARDING = 1;
export const NO_ALIGHTING = 2;

/**
 * Every trip's stop-to-stop hops ("connections"), sorted by departure, as parallel arrays.
 * Times are seconds after the trip's service-day start (can exceed 24 h). Stations are the
 * top-level stops; fromStop/toStop are the actual stop (platform) indexes.
 */
export interface ConnectionGraph {
  stationIds: string[];
  stationNames: string[];
  /** Any stop_id (station or platform) -> station index. */
  stationOf: Map<string, number>;
  stopPlatform: (string | null)[];
  trips: { serviceId: string; row: TrainRow }[];
  dep: Int32Array;
  arr: Int32Array;
  from: Int32Array;
  to: Int32Array;
  fromStop: Int32Array;
  toStop: Int32Array;
  trip: Int32Array;
  /** NO_BOARDING / NO_ALIGHTING bits. */
  flags: Uint8Array;
}

export class Timetable {
  private readonly db: Database;
  private readonly stmts = new Map<string, Statement>();
  private readonly services = new Map<string, { json: string; set: Set<string> }>();
  private graph: ConnectionGraph | null = null;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true });
  }

  close(): void {
    // Finalize first: unfinalized statements keep the file locked on Windows.
    for (const s of this.stmts.values()) s.finalize();
    this.stmts.clear();
    this.db.close();
  }

  private q<R>(sql: string): Statement<R, [Record<string, string | number>]> {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s as unknown as Statement<R, [Record<string, string | number>]>;
  }

  meta(): Record<string, string> {
    const rows = this.q<{ key: string; value: string | null }>('SELECT key, value FROM meta').all({});
    return Object.fromEntries(rows.filter((r) => r.value !== null).map((r) => [r.key, r.value as string]));
  }

  /** service_ids running on a service date (calendar + calendar_dates exceptions). */
  activeServices(date: string): { json: string; set: Set<string> } {
    let entry = this.services.get(date);
    if (!entry) {
      const day = DAY_COLUMNS[weekdayIndex(date)];
      const ids = this.q<{ service_id: string }>(
        `SELECT service_id FROM calendar WHERE $date BETWEEN start_date AND end_date AND ${day} = 1
         UNION
         SELECT service_id FROM calendar_dates WHERE date = $date AND exception_type = 1
         EXCEPT
         SELECT service_id FROM calendar_dates WHERE date = $date AND exception_type = 2`,
      )
        .all({ $date: date })
        .map((r) => r.service_id);
      if (this.services.size > 31) this.services.clear();
      entry = { json: JSON.stringify(ids), set: new Set(ids) };
      this.services.set(date, entry);
    }
    return entry;
  }

  /** Top-level stations whose name contains the query (accent and case insensitive). */
  searchStations(query: string, limit = 20): Station[] {
    const q = normalizeName(query);
    if (q === '') return [];
    return this.q<Station>(
      `SELECT stop_id AS id, stop_name AS name FROM stops
       WHERE parent_station IS NULL AND COALESCE(location_type, 0) IN (0, 1)
         AND instr(stop_name_norm, $q) > 0
       ORDER BY instr(stop_name_norm, $q) = 1 DESC, length(stop_name), stop_name
       LIMIT $limit`,
    ).all({ $q: q, $limit: limit });
  }

  /**
   * Every top-level station (the same set searchStations looks in), sorted by name.
   * The frontend loads this once and searches it locally (~1200 stations for MÁV).
   */
  allStations(): Station[] {
    return this.q<Station>(
      `SELECT stop_id AS id, stop_name AS name FROM stops
       WHERE parent_station IS NULL AND COALESCE(location_type, 0) IN (0, 1)
         AND stop_name IS NOT NULL
       ORDER BY stop_name`,
    ).all({});
  }

  /** A station and all its stop_ids (the station itself plus its platforms). Child ids resolve to the parent. */
  station(id: string): { station: Station; stopIds: string[] } | null {
    const row = this.q<{ stop_id: string; stop_name: string; parent_station: string | null }>(
      'SELECT stop_id, stop_name, parent_station FROM stops WHERE stop_id = $id',
    ).get({ $id: id });
    if (!row) return null;
    if (row.parent_station && row.parent_station !== id) {
      const parent = this.station(row.parent_station);
      if (parent) return parent;
    }
    const stopIds = this.q<{ stop_id: string }>(
      'SELECT stop_id FROM stops WHERE stop_id = $id OR parent_station = $id',
    )
      .all({ $id: row.stop_id })
      .map((r) => r.stop_id);
    return { station: { id: row.stop_id, name: row.stop_name }, stopIds };
  }

  /** Departures from a station in [now - lookback, now + window], sorted by planned time. */
  departures(
    stationId: string,
    opts: { now: number; limit?: number; lookbackSec?: number; windowSec?: number },
  ): { station: Station; departures: PlannedDeparture[] } | null {
    const st = this.station(stationId);
    if (!st) return null;
    const limit = opts.limit ?? 20;
    const from = opts.now - (opts.lookbackSec ?? 0) * 1000;
    const to = opts.now + (opts.windowSec ?? 24 * 3600) * 1000;
    const stmt = this.q<TrainRow & { stop_id: string; departure_time: number; platform_code: string | null }>(
      `SELECT ${TRAIN_COLUMNS}, st.stop_id, st.departure_time, s.platform_code
       FROM json_each($stops) AS sid
       CROSS JOIN stop_times st ON st.stop_id = sid.value
       CROSS JOIN trips t ON t.trip_id = st.trip_id
       LEFT JOIN routes r ON r.route_id = t.route_id
       JOIN stops s ON s.stop_id = st.stop_id
       WHERE st.departure_time BETWEEN $from AND $to
         AND t.service_id IN (SELECT value FROM json_each($services))
         AND COALESCE(st.pickup_type, 0) <> 1
         AND EXISTS (SELECT 1 FROM stop_times n WHERE n.trip_id = st.trip_id AND n.stop_sequence > st.stop_sequence)
       ORDER BY st.departure_time
       LIMIT $limit`,
    );

    const found: { at: number; dep: PlannedDeparture }[] = [];
    const stops = JSON.stringify(st.stopIds);
    for (const date of datesCovering(from, to)) {
      const services = this.activeServices(date);
      if (services.set.size === 0) continue;
      const start = serviceDayStart(date);
      const toSec = Math.floor((to - start) / 1000);
      if (toSec < 0) continue;
      const rows = stmt.all({
        $stops: stops,
        $services: services.json,
        $from: Math.ceil((from - start) / 1000),
        $to: toSec,
        $limit: limit,
      });
      for (const r of rows) {
        const at = start + r.departure_time * 1000;
        found.push({
          at,
          dep: { ...trainInfo(r, date), stopId: r.stop_id, platform: r.platform_code, departure: toIso(at) },
        });
      }
    }
    found.sort((a, b) => a.at - b.at || (a.dep.label ?? '').localeCompare(b.dep.label ?? ''));
    return { station: st.station, departures: found.slice(0, limit).map((f) => f.dep) };
  }

  /** Direct trains from station A to station B departing in [time, time + window]. */
  route(
    fromId: string,
    toId: string,
    opts: { time: number; limit?: number; windowSec?: number },
  ): { from: Station; to: Station; connections: PlannedConnection[] } | null {
    const a = this.station(fromId);
    const b = this.station(toId);
    if (!a || !b) return null;
    const limit = opts.limit ?? 10;
    const from = opts.time;
    const to = opts.time + (opts.windowSec ?? 24 * 3600) * 1000;
    const stmt = this.q<
      TrainRow & { dep: number; arr: number; from_platform: string | null; to_platform: string | null }
    >(
      `SELECT ${TRAIN_COLUMNS}, a.departure_time AS dep, b.arrival_time AS arr,
              sa.platform_code AS from_platform, sb.platform_code AS to_platform,
              MIN(b.stop_sequence) AS b_seq
       FROM json_each($from) AS sid
       CROSS JOIN stop_times a ON a.stop_id = sid.value
       CROSS JOIN trips t ON t.trip_id = a.trip_id
       CROSS JOIN stop_times b ON b.trip_id = a.trip_id AND b.stop_sequence > a.stop_sequence
       LEFT JOIN routes r ON r.route_id = t.route_id
       JOIN stops sa ON sa.stop_id = a.stop_id
       JOIN stops sb ON sb.stop_id = b.stop_id
       WHERE b.stop_id IN (SELECT value FROM json_each($to))
         AND a.departure_time BETWEEN $fromSec AND $toSec
         AND t.service_id IN (SELECT value FROM json_each($services))
         AND COALESCE(a.pickup_type, 0) <> 1
         AND COALESCE(b.drop_off_type, 0) <> 1
       GROUP BY a.trip_id, a.stop_sequence
       ORDER BY a.departure_time
       LIMIT $limit`,
    );

    const found: { at: number; c: PlannedConnection }[] = [];
    const fromStops = JSON.stringify(a.stopIds);
    const toStops = JSON.stringify(b.stopIds);
    for (const date of datesCovering(from, to)) {
      const services = this.activeServices(date);
      if (services.set.size === 0) continue;
      const start = serviceDayStart(date);
      const toSec = Math.floor((to - start) / 1000);
      if (toSec < 0) continue;
      const rows = stmt.all({
        $from: fromStops,
        $to: toStops,
        $services: services.json,
        $fromSec: Math.ceil((from - start) / 1000),
        $toSec: toSec,
        $limit: limit,
      });
      for (const r of rows) {
        const dep = start + r.dep * 1000;
        const arr = start + r.arr * 1000;
        found.push({
          at: dep,
          c: {
            ...trainInfo(r, date),
            departure: toIso(dep),
            arrival: toIso(arr),
            durationMin: Math.round((arr - dep) / 60000),
            fromPlatform: r.from_platform,
            toPlatform: r.to_platform,
          },
        });
      }
    }
    found.sort((x, y) => x.at - y.at);
    return { from: a.station, to: b.station, connections: found.slice(0, limit).map((f) => f.c) };
  }

  /** Every trip's stop-to-stop hops, for the journey planner (planner.ts). Built once per database. */
  connectionGraph(): ConnectionGraph {
    if (this.graph) return this.graph;
    const stations = this.q<{ stop_id: string; stop_name: string; parent_station: string | null; platform_code: string | null }>(
      'SELECT stop_id, stop_name, parent_station, platform_code FROM stops',
    ).all({});
    const stationIds: string[] = [];
    const stationNames: string[] = [];
    const stationOf = new Map<string, number>(); // any stop_id (station or platform) -> station index
    const top = new Map<string, number>();
    for (const s of stations) {
      if (s.parent_station) continue;
      top.set(s.stop_id, stationIds.length);
      stationIds.push(s.stop_id);
      stationNames.push(s.stop_name);
    }
    const stopIds: string[] = [];
    const stopIndex = new Map<string, number>();
    const stopPlatform: (string | null)[] = [];
    for (const s of stations) {
      const st = top.get(s.parent_station ?? s.stop_id);
      if (st === undefined) continue;
      stationOf.set(s.stop_id, st);
      stopIndex.set(s.stop_id, stopIds.length);
      stopIds.push(s.stop_id);
      stopPlatform.push(s.platform_code);
    }

    const tripRows = this.q<TrainRow & { service_id: string }>(
      `SELECT ${TRAIN_COLUMNS}, t.service_id FROM trips t LEFT JOIN routes r ON r.route_id = t.route_id`,
    ).all({});
    const tripIndex = new Map<string, number>();
    tripRows.forEach((t, i) => tripIndex.set(t.trip_id, i));

    const rows = this.q<{
      trip_id: string;
      stop_id: string;
      arrival_time: number | null;
      departure_time: number | null;
      pickup_type: number | null;
      drop_off_type: number | null;
    }>(
      `SELECT trip_id, stop_id, arrival_time, departure_time, pickup_type, drop_off_type
       FROM stop_times ORDER BY trip_id, stop_sequence`,
    ).all({});
    const list: { dep: number; arr: number; from: number; to: number; fromStop: number; toStop: number; trip: number; flags: number }[] = [];
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i]!;
      const b = rows[i + 1]!;
      if (a.trip_id !== b.trip_id) continue;
      const dep = a.departure_time ?? a.arrival_time;
      const arr = b.arrival_time ?? b.departure_time;
      const trip = tripIndex.get(a.trip_id);
      const from = stationOf.get(a.stop_id);
      const to = stationOf.get(b.stop_id);
      if (dep === null || arr === null || trip === undefined || from === undefined || to === undefined) continue;
      const flags = (a.pickup_type === 1 ? NO_BOARDING : 0) | (b.drop_off_type === 1 ? NO_ALIGHTING : 0);
      list.push({ dep, arr, from, to, fromStop: stopIndex.get(a.stop_id)!, toStop: stopIndex.get(b.stop_id)!, trip, flags });
    }
    list.sort((x, y) => x.dep - y.dep);
    const n = list.length;
    const g: ConnectionGraph = {
      stationIds,
      stationNames,
      stationOf,
      stopPlatform,
      trips: tripRows.map((t) => ({ serviceId: t.service_id, row: t })),
      dep: new Int32Array(n),
      arr: new Int32Array(n),
      from: new Int32Array(n),
      to: new Int32Array(n),
      fromStop: new Int32Array(n),
      toStop: new Int32Array(n),
      trip: new Int32Array(n),
      flags: new Uint8Array(n),
    };
    list.forEach((c, i) => {
      g.dep[i] = c.dep;
      g.arr[i] = c.arr;
      g.from[i] = c.from;
      g.to[i] = c.to;
      g.fromStop[i] = c.fromStop;
      g.toStop[i] = c.toStop;
      g.trip[i] = c.trip;
      g.flags[i] = c.flags;
    });
    this.graph = g;
    return g;
  }

  /** Train info for a trip of the connection graph on a service date. */
  graphTrainInfo(row: TrainRow, serviceDate: string): TrainInfo {
    return trainInfo(row, serviceDate);
  }

  /**
   * All stops of a trip on a service date. Without a date: the run that is in
   * progress or next to come among yesterday, today and tomorrow.
   */
  trip(tripId: string, opts: { now: number; date?: string }): PlannedTrip | null {
    const row = this.q<TrainRow & { service_id: string }>(
      `SELECT ${TRAIN_COLUMNS}, t.service_id FROM trips t
       LEFT JOIN routes r ON r.route_id = t.route_id WHERE t.trip_id = $id`,
    ).get({ $id: tripId });
    if (!row) return null;
    const stops = this.q<{
      stop_sequence: number;
      stop_id: string;
      stop_name: string;
      parent_station: string | null;
      platform_code: string | null;
      arrival_time: number | null;
      departure_time: number | null;
    }>(
      `SELECT st.stop_sequence, st.stop_id, s.stop_name, s.parent_station, s.platform_code,
              st.arrival_time, st.departure_time
       FROM stop_times st JOIN stops s ON s.stop_id = st.stop_id
       WHERE st.trip_id = $id ORDER BY st.stop_sequence`,
    ).all({ $id: tripId });

    let date = opts.date;
    if (!date) {
      const today = localDate(opts.now);
      const candidates = [addDays(today, -1), today, addDays(today, 1)].filter((d) =>
        this.activeServices(d).set.has(row.service_id),
      );
      const lastTime = stops.at(-1)?.arrival_time ?? 0;
      date =
        candidates.find((d) => serviceDayStart(d) + lastTime * 1000 >= opts.now) ?? candidates.at(-1) ?? today;
    }
    const start = serviceDayStart(date);
    const at = (sec: number | null) => (sec === null ? null : toIso(start + sec * 1000));

    return {
      ...trainInfo(row, date),
      runsOnDate: this.activeServices(date).set.has(row.service_id),
      stops: stops.map((s, i) => ({
        sequence: s.stop_sequence,
        stopId: s.stop_id,
        stationId: s.parent_station ?? s.stop_id,
        name: s.stop_name,
        platform: s.platform_code,
        arrival: i === 0 ? null : at(s.arrival_time),
        departure: i === stops.length - 1 ? null : at(s.departure_time),
      })),
    };
  }
}
