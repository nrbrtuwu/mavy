// Shapes of the Mávy server API (see src/merge.ts and src/gtfs/queries.ts on the server).

export type LiveState = "live" | "stale" | "none"

export interface LiveInfo {
  state: LiveState
  fetchedAt: string | null
}

export interface TimeInfo {
  planned: string
  expected: string | null
  delayMin: number | null
}

export interface Station {
  id: string
  name: string
}

export interface TrainInfo {
  tripId: string
  serviceDate: string
  trainNumber: string | null
  label: string | null
  headsign: string | null
}

export interface Departure extends TrainInfo {
  stopId: string
  platform: string | null
  departure: TimeInfo
  /** "+N perc": the train's current delay (absent: use departure.delayMin). */
  currentDelayMin?: number | null
  cancelled: boolean
  reason: string | null
  live: LiveState
}

/** One train of a trip with changes. */
export interface Leg extends TrainInfo {
  from: Station
  to: Station
  departure: TimeInfo
  arrival: TimeInfo
  fromPlatform: string | null
  toPlatform: string | null
}

export interface Connection extends TrainInfo {
  departure: TimeInfo
  arrival: TimeInfo
  durationMin: number
  /** "+N perc": the train's current delay (absent: use departure.delayMin). */
  currentDelayMin?: number | null
  fromPlatform: string | null
  toPlatform: string | null
  cancelled: boolean
  reason: string | null
  live: LiveState
  /** Trips with changes: every train in order (the first one has live data). Absent = direct. */
  legs?: Leg[]
}

export interface Stop {
  sequence: number
  stopId: string
  stationId: string
  name: string
  platform: string | null
  arrival: TimeInfo | null
  departure: TimeInfo | null
  cancelled: boolean
  passed: boolean | null
}

export interface Trip extends TrainInfo {
  runsOnDate: boolean
  cancelled: boolean
  delayMin: number | null
  reason: string | null
  live: LiveInfo
  stops: Stop[]
}

export interface BoardResponse {
  station: Station
  live: LiveInfo
  departures: Departure[]
}

export interface RouteResponse {
  from: Station
  to: Station
  live: LiveInfo
  connections: Connection[]
}

export interface StationsResponse {
  stations: Station[]
}

