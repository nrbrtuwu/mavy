// The route form's last stations, stored on this device (localStorage), so they are
// still filled in after a reload or reopening the installed app.

import type { Station } from "./types"

export interface LastRoute {
  from: Station | null
  to: Station | null
}

const KEY = "mavy.lastRoute.v1"
const EMPTY: LastRoute = { from: null, to: null }

function asStation(value: unknown): Station | null {
  const v = value as { id?: unknown; name?: unknown } | null
  return v && typeof v.id === "string" && typeof v.name === "string" ? { id: v.id, name: v.name } : null
}

/** Parse stored JSON; anything broken gives empty fields. */
export function parseLastRoute(raw: string | null): LastRoute {
  try {
    const v = JSON.parse(raw ?? "null") as { from?: unknown; to?: unknown } | null
    return v ? { from: asStation(v.from), to: asStation(v.to) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function readLastRoute(): LastRoute {
  try {
    return parseLastRoute(localStorage.getItem(KEY))
  } catch {
    return EMPTY
  }
}

export function writeLastRoute(route: LastRoute): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(route))
  } catch {
    // storage blocked or full: it is just not remembered
  }
}
