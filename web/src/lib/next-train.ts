// The next train of a favourite (Kedvencek screen): first one not yet gone, from the same
// board / route data the screens load (and the start-up preload already fetched).

import type { BoardResponse, Departure, RouteResponse, TimeInfo } from "./types"

export interface NextTrain {
  departure: TimeInfo
  /** Route favourites: arrival at the destination. */
  arrival: TimeInfo | null
  /** Board favourites: where the train goes. */
  headsign: string | null
  /** "+N perc" as on the board and route screens. */
  delayMin: number | null
  cancelled: boolean
  live: boolean
}

/** Gone = expected (else planned) departure more than a minute ago. */
function notGone(t: TimeInfo, cancelled: boolean, now: number): boolean {
  return Date.parse(cancelled ? t.planned : (t.expected ?? t.planned)) >= now - 60_000
}

export function nextFromBoard(data: BoardResponse, now = Date.now()): NextTrain | null {
  const d: Departure | undefined = data.departures.find((x) => notGone(x.departure, x.cancelled, now))
  if (!d) return null
  return {
    departure: d.departure,
    arrival: null,
    headsign: d.headsign,
    delayMin: d.currentDelayMin ?? d.departure.delayMin,
    cancelled: d.cancelled,
    live: d.live !== "none",
  }
}

export function nextFromRoute(data: RouteResponse, now = Date.now()): NextTrain | null {
  const c = data.connections.find((x) => notGone(x.departure, x.cancelled, now))
  if (!c) return null
  return {
    departure: c.departure,
    arrival: c.arrival,
    headsign: null,
    delayMin: c.currentDelayMin ?? c.departure.delayMin,
    cancelled: c.cancelled,
    live: c.live !== "none",
  }
}
