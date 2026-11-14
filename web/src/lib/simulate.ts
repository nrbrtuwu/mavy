// Simulated delays for previewing the design while no real live source exists.
// Off by default; switched on in Beállítások ("Szimulált késések"). Everything here is
// made up in the browser and clearly labelled as such in the UI (LiveStatus `demo`).
// Deterministic per train run (trip id + service date), so a train keeps the same fake
// delay across refreshes.

import type { BoardResponse, Connection, Departure, LiveInfo, RouteResponse, TimeInfo, Trip } from "./types"

const REASONS = [
  "Pályakarbantartás miatti lassújel (szimulált)",
  "Késve érkező csatlakozás (szimulált)",
  "Műszaki hiba (szimulált)",
]

/** 32-bit FNV-1a hash -> [0, 1). */
function unit(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

export interface SimulatedRun {
  cancelled: boolean
  delayMin: number
  reason: string | null
}

/** About 5% cancelled, 45% late by 1-25 min (reason from 10 min), the rest on time. */
export function simulateRun(tripId: string, serviceDate: string): SimulatedRun {
  const r = unit(`${tripId}|${serviceDate}`)
  const r2 = unit(`${serviceDate}|${tripId}|delay`)
  if (r < 0.05) return { cancelled: true, delayMin: 0, reason: REASONS[2]! }
  if (r < 0.5) {
    const delayMin = 1 + Math.floor(r2 * 25)
    return { cancelled: false, delayMin, reason: delayMin >= 10 ? REASONS[Math.floor(r2 * 1000) % REASONS.length]! : null }
  }
  return { cancelled: false, delayMin: 0, reason: null }
}

/** '2026-11-13T11:32:00+01:00' + 8 min -> '2026-11-13T11:40:00+01:00' (keeps the offset). */
export function addMinutes(iso: string, minutes: number): string {
  const offset = iso.slice(19) // "+01:00"
  const sign = offset.startsWith("-") ? -1 : 1
  const offsetMin = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)))
  const local = new Date(Date.parse(iso) + (minutes + offsetMin) * 60_000)
  return `${local.toISOString().slice(0, 19)}${offset}`
}

function delayed(time: TimeInfo, run: SimulatedRun): TimeInfo {
  if (run.cancelled) return { planned: time.planned, expected: null, delayMin: null }
  return { planned: time.planned, expected: addMinutes(time.planned, run.delayMin), delayMin: run.delayMin }
}

const DEMO_LIVE = (): LiveInfo => ({ state: "live", fetchedAt: new Date().toISOString() })

export function simulateBoard(data: BoardResponse): BoardResponse {
  return {
    ...data,
    live: DEMO_LIVE(),
    departures: data.departures.map((d): Departure => {
      const run = simulateRun(d.tripId, d.serviceDate)
      return { ...d, departure: delayed(d.departure, run), cancelled: run.cancelled, reason: run.reason, live: "live" }
    }),
  }
}

export function simulateRoute(data: RouteResponse): RouteResponse {
  return {
    ...data,
    live: DEMO_LIVE(),
    connections: data.connections.map((c): Connection => {
      const run = simulateRun(c.tripId, c.serviceDate)
      return {
        ...c,
        departure: delayed(c.departure, run),
        arrival: delayed(c.arrival, run),
        cancelled: run.cancelled,
        reason: run.reason,
        live: "live",
      }
    }),
  }
}

export function simulateTrip(data: Trip): Trip {
  const run = simulateRun(data.tripId, data.serviceDate)
  return {
    ...data,
    live: DEMO_LIVE(),
    cancelled: run.cancelled,
    delayMin: run.cancelled ? null : run.delayMin,
    reason: run.reason,
    stops: data.stops.map((s) => ({
      ...s,
      cancelled: run.cancelled,
      arrival: s.arrival && delayed(s.arrival, run),
      departure: s.departure && delayed(s.departure, run),
    })),
  }
}
