// Live data as the rest of the app sees it. Independent of the upstream API:
// a future official MÁV API only needs a new implementation of LiveSource.
//
// All times are ISO 8601 with the Budapest offset (see src/time.ts).
// Service dates are 'YYYYMMDD'.

export interface LiveStop {
  /** Upstream station code, if the API gives one. May or may not match the GTFS stop_id. */
  stationCode: string | null;
  stationName: string;
  plannedArrival: string | null;
  plannedDeparture: string | null;
  /** null = no live estimate for this stop. */
  expectedArrival: string | null;
  expectedDeparture: string | null;
  platform: string | null;
  cancelled: boolean;
  /** true once the train has left this stop, null if the API does not say. */
  passed: boolean | null;
}

export interface LiveTrain {
  /** GTFS trip_id (without any feed prefix), if the source knows it. Preferred match key. */
  tripId: string | null;
  trainNumber: string;
  serviceDate: string;
  cancelled: boolean;
  /** Current delay in minutes, null if unknown. */
  delayMin: number | null;
  /** Why the train is late or cancelled, as the source words it. null if not given. */
  reason: string | null;
  stops: LiveStop[];
}

export interface LiveDeparture {
  /** GTFS trip_id (without any feed prefix), if the source knows it. Preferred match key. */
  tripId: string | null;
  trainNumber: string;
  serviceDate: string | null;
  destination: string | null;
  plannedDeparture: string;
  expectedDeparture: string | null;
  delayMin: number | null;
  /** The train's delay right now, if the source states it separately (shown as "+N perc"). */
  currentDelayMin?: number | null;
  platform: string | null;
  cancelled: boolean;
  /** Why the train is late or cancelled, as the source words it. null if not given. */
  reason: string | null;
}

/** A train arriving at the board's station (also ones that continue). */
export interface LiveArrival {
  trainNumber: string;
  serviceDate: string | null;
  plannedArrival: string;
  /** The station's own predicted (or actual) arrival, null if none yet. */
  expectedArrival: string | null;
  platform: string | null;
}

export interface LiveBoard {
  stationCode: string | null;
  stationName: string;
  departures: LiveDeparture[];
  /** Arrivals, if the source gives them. Used for the arrival time in route results. */
  arrivals?: LiveArrival[];
}

/** A live answer plus how fresh it is. stale = upstream failed, this is the last good copy. */
export interface LiveResult<T> {
  data: T;
  fetchedAt: string;
  stale: boolean;
}

export interface LiveStatus {
  /** unknown = no request yet, ok = last request worked, backoff = failing, waiting to retry. */
  state: 'unknown' | 'ok' | 'backoff';
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  retryAt: string | null;
  cachedEntries: number;
}

export interface StationRef {
  gtfsStopId: string;
  name: string;
}

/** Identifies one run of a train. Sources use whichever key they support. */
export interface TrainRef {
  tripId: string;
  trainNumber: string | null;
  serviceDate: string;
}

export interface LiveSource {
  /** One train on one service date. data = null if the live API does not know it. */
  train(ref: TrainRef): Promise<LiveResult<LiveTrain | null>>;
  /** Live departures at one station. data = null if the live API does not know the station. */
  departures(station: StationRef): Promise<LiveResult<LiveBoard | null>>;
  status(): LiveStatus;
}

/** Thrown when there is no live data at all (upstream failing and nothing cached). */
export class LiveUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryAt: number | null,
  ) {
    super(message);
    this.name = 'LiveUnavailableError';
  }
}
