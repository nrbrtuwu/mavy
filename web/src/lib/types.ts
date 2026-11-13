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
  cancelled: boolean
  reason: string | null
  live: LiveState
}

export interface Connection extends TrainInfo {
  departure: TimeInfo
  arrival: TimeInfo
  durationMin: number
  fromPlatform: string | null
  toPlatform: string | null
  cancelled: boolean
  reason: string | null
  live: LiveState
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
