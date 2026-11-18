// The stations this device picks most often from a search (route form or station search),
// stored on the device (localStorage). The top 5 are offered when the search field is empty
// and rank first among the results while typing.

import { useSyncExternalStore } from "react"
import { useSettings } from "./settings"
import type { Station } from "./types"

interface Entry {
  name: string
  count: number
  /** Last pick, ms since epoch: breaks ties, and decides what is forgotten first. */
  last: number
}
type Counts = Record<string, Entry>

const KEY = "mavy.stationCounts.v1"
const EVENT = "mavy:station-counts"
export const TOP = 5
/** Entries kept at most; the least used are dropped. */
const MAX_ENTRIES = 50

/** Parse stored JSON; broken entries are skipped, anything else broken gives no counts. */
export function parseCounts(raw: string | null): Counts {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown> | null
    const out: Counts = {}
    for (const [id, e] of Object.entries(v ?? {})) {
      const x = e as Partial<Entry> | null
      if (typeof x?.name === "string" && typeof x.count === "number" && x.count > 0 && typeof x.last === "number") {
        out[id] = { name: x.name, count: x.count, last: x.last }
      }
    }
    return out
  } catch {
    return {}
  }
}

const byUse = ([, a]: [string, Entry], [, b]: [string, Entry]) => b.count - a.count || b.last - a.last

/** One more pick of this station. Keeps the MAX_ENTRIES most used. */
export function addPick(counts: Counts, s: Station, now: number): Counts {
  const prev = counts[s.id]
  const next: Counts = { ...counts, [s.id]: { name: s.name, count: (prev?.count ?? 0) + 1, last: now } }
  const entries = Object.entries(next)
  if (entries.length <= MAX_ENTRIES) return next
  return Object.fromEntries(entries.sort(byUse).slice(0, MAX_ENTRIES))
}

/** The station taken off the list (its count is dropped too, so it starts again from 0). */
export function removeStation(counts: Counts, id: string): Counts {
  if (!(id in counts)) return counts
  const next = { ...counts }
  delete next[id]
  return next
}

/** Most picked first (ties: most recent first). */
export function topStations(counts: Counts, limit = TOP): Station[] {
  return Object.entries(counts)
    .sort(byUse)
    .slice(0, limit)
    .map(([id, e]) => ({ id, name: e.name }))
}

/** Search results with the top stations among them moved to the front (in top order). */
export function frequentFirst(results: Station[], top: Station[]): Station[] {
  const rank = new Map(top.map((s, i) => [s.id, i]))
  return results
    .map((s, i) => ({ s, i, r: rank.get(s.id) ?? Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ s }) => s)
}

let cacheRaw: string | null | undefined
let cache: Counts = {}

function read(): Counts {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    // storage blocked: no counts
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw
    cache = parseCounts(raw)
  }
  return cache
}

function write(counts: Counts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(counts))
  } catch {
    // storage full or blocked: not saved
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Count a station picked from a search (nothing when turned off in Settings). */
export function recordStationPick(s: Station, enabled: boolean): void {
  if (enabled) write(addPick(read(), s, Date.now()))
}

/** The X on a "Gyakran keresett" row. */
export function forgetStation(id: string): void {
  write(removeStation(read(), id))
}

const NONE: Station[] = []

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

let topCounts: Counts | null = null
let topCache: Station[] = []

/** The top 5 stations of this device, updated live; none when turned off in Settings. */
export function useTopStations(): Station[] {
  const { frequentStations } = useSettings()
  const top = useSyncExternalStore(subscribe, () => {
    const counts = read()
    if (counts !== topCounts) {
      topCounts = counts
      topCache = topStations(counts)
    }
    return topCache
  })
  return frequentStations ? top : NONE
}

/** Counts a picked station, if the setting is on. */
export function useRecordStationPick(): (s: Station) => void {
  const { frequentStations } = useSettings()
  return (s) => recordStationPick(s, frequentStations)
}
