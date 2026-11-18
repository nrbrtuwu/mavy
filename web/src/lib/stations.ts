// Station list for instant search: loaded once when the app starts (GET /api/stations/all,
// ~1200 stations), then every keystroke searches it in memory. Same matching and order as
// the server's /api/stations: accent and case insensitive "contains", names that start
// with the query first, then shorter names, then alphabetical.

import { api } from "./api"
import type { Station, StationIdsResponse, StationsResponse } from "./types"

/** "Győr-Gyárváros" -> "gyor-gyarvaros" (same as the server's normalizeName). */
export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
}

export interface IndexedStation extends Station {
  norm: string
}

export function indexStations(stations: Station[]): IndexedStation[] {
  return stations.map((s) => ({ ...s, norm: normalizeName(s.name) }))
}

/** Local search over the indexed list. Empty query: no results. `only`: allowed station ids. */
export function searchStationsLocal(
  list: IndexedStation[],
  query: string,
  limit = 20,
  only: ReadonlySet<string> | null = null,
): Station[] {
  const q = normalizeName(query)
  if (q === "") return []
  const hits: { s: IndexedStation; at: number }[] = []
  for (const s of list) {
    if (only && !only.has(s.id)) continue
    const at = s.norm.indexOf(q)
    if (at !== -1) hits.push({ s, at })
  }
  hits.sort(
    (a, b) =>
      Number(b.at === 0) - Number(a.at === 0) ||
      a.s.name.length - b.s.name.length ||
      (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : 0),
  )
  return hits.slice(0, limit).map(({ s }) => ({ id: s.id, name: s.name }))
}

let list: IndexedStation[] | null = null
let loading: Promise<IndexedStation[] | null> | null = null
const listeners = new Set<() => void>()

/** The loaded list, or null while it is still loading (or failed: callers then use the server). */
export function stationList(): IndexedStation[] | null {
  return list
}

/** Start loading (once). Safe to call many times; a failed load is retried on the next call. */
export function loadStationList(): Promise<IndexedStation[] | null> {
  if (list) return Promise.resolve(list)
  if (!loading) {
    loading = api<StationsResponse>("/api/stations/all")
      .then((data) => {
        list = indexStations(data.stations)
        for (const fn of listeners) fn()
        return list
      })
      .catch(() => {
        loading = null // try again later
        return null
      })
  }
  return loading
}

export function onStationListLoaded(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------------------------------------------------------------- reachable stations

const reachable = new Map<string, ReadonlySet<string>>()
const reachableLoading = new Map<string, Promise<void>>()
const reachableFailed = new Set<string>()

/** Stations a direct train reaches from this one, or null until loaded (or if loading failed). */
export function reachableFrom(stationId: string): ReadonlySet<string> | null {
  return reachable.get(stationId) ?? null
}

/** True when the last attempt to load this station's list failed. */
export function reachableFailedFor(stationId: string): boolean {
  return reachableFailed.has(stationId)
}

/** Load (once per station) the stations a direct train reaches from it. */
export function loadReachable(stationId: string): Promise<void> {
  if (reachable.has(stationId)) return Promise.resolve()
  let p = reachableLoading.get(stationId)
  if (!p) {
    p = api<StationIdsResponse>(`/api/stations/${encodeURIComponent(stationId)}/reachable`)
      .then((data) => {
        reachable.set(stationId, new Set(data.stations))
        reachableFailed.delete(stationId)
        for (const fn of listeners) fn()
      })
      .catch(() => {
        // no filter then (the form says so); tried again next time
        reachableFailed.add(stationId)
      })
      .finally(() => reachableLoading.delete(stationId))
    reachableLoading.set(stationId, p)
  }
  return p
}
