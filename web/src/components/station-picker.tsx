// Station search input with a result list. Used on the station search and route form screens.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { History, MapPin, Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { api, errorMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { forgetStation, frequentFirst, useTopStations } from "@/lib/frequent-stations"
import {
  loadReachable,
  loadStationList,
  onStationListLoaded,
  reachableFailedFor,
  reachableFrom,
  searchStationsLocal,
  stationList,
} from "@/lib/stations"
import type { Station, StationsResponse } from "@/lib/types"

/** Server search results kept in memory (only used until the station list has loaded). */
const resultCache = new Map<string, Station[]>()

/**
 * Stations a direct train reaches from `stationId`: `set` is null with no station, while
 * loading, or when loading failed (`failed`).
 */
export function useReachable(stationId: string | null): { set: ReadonlySet<string> | null; failed: boolean } {
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (!stationId) return
    let alive = true
    void loadReachable(stationId).then(() => alive && setLoaded((n) => n + 1))
    return () => {
      alive = false
    }
  }, [stationId])
  if (!stationId) return { set: null, failed: false }
  const set = reachableFrom(stationId)
  return { set, failed: !set && reachableFailedFor(stationId) }
}

export interface StationSearch {
  stations: Station[] | null
  error: string | null
  /** The list is this device's most picked stations (empty query), not search results. */
  frequent: boolean
}

/**
 * Station search. With the station list loaded (normally right after start-up): instant,
 * in memory, no request per keystroke. Until then: debounced server search.
 * Empty query: the device's most picked stations. stations = null for a one-letter query.
 * `only`: allowed station ids (e.g. reachable by a direct train), null = all.
 */
export function useStationSearch(query: string, only: ReadonlySet<string> | null = null): StationSearch {
  const top = useTopStations()
  const [result, setResult] = useState<{ q: string; stations: Station[] | null; error: string | null }>({
    q: "",
    stations: null,
    error: null,
  })
  const q = query.trim()
  const local = useSyncExternalStore(onStationListLoaded, stationList)
  const allowed = useMemo(() => (only ? (s: Station) => only.has(s.id) : () => true), [only])
  const localResults = useMemo(
    () => (local && q.length >= 2 ? searchStationsLocal(local, q, 20, only) : null),
    [local, q, only],
  )

  useEffect(() => {
    void loadStationList()
  }, [])

  useEffect(() => {
    if (local || q.length < 2 || resultCache.has(q)) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const data = await api<StationsResponse>(`/api/stations?q=${encodeURIComponent(q)}`, controller.signal)
        if (resultCache.size > 100) resultCache.clear()
        resultCache.set(q, data.stations)
        setResult({ q, stations: data.stations, error: null })
      } catch (err) {
        if (!controller.signal.aborted) setResult({ q, stations: null, error: errorMessage(err) })
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [local, q])

  const ranked = (list: Station[]) => frequentFirst(list.filter(allowed), top)
  if (q === "") {
    const frequent = top.filter(allowed)
    return { stations: frequent.length ? frequent : null, error: null, frequent: true }
  }
  if (q.length < 2) return { stations: null, error: null, frequent: false }
  if (localResults) return { stations: ranked(localResults), error: null, frequent: false }
  const cached = resultCache.get(q)
  if (cached) return { stations: ranked(cached), error: null, frequent: false }
  if (result.q !== q) return { stations: null, error: null, frequent: false }
  return { stations: result.stations && ranked(result.stations), error: result.error, frequent: false }
}

export function SearchInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string
  /** For screen readers only (no visible label). */
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id={id}
        aria-label={label}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Állomás neve"}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        className="h-11 pl-9 text-base md:text-base"
      />
    </div>
  )
}

/**
 * Result list: links (station search) or buttons (route form). `onPick` runs for both
 * (links: before the page changes). `note`: one quiet line above the list.
 */
export function StationResults({
  search: { stations, error, frequent },
  onPick,
  hrefFor,
  note,
  empty = "Nincs találat",
}: {
  search: StationSearch
  onPick?: (s: Station) => void
  hrefFor?: (s: Station) => string
  note?: string | null
  empty?: string
}) {
  if (error) return <p className="px-1 text-sm text-destructive">{error}</p>
  if (stations === null) return null
  const label = frequent ? "Gyakran keresett" : note
  return (
    <div className="flex flex-col gap-2">
      {label && <p className="px-1 text-xs text-muted-foreground">{label}</p>}
      {stations.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <StationList stations={stations} frequent={frequent} onPick={onPick} hrefFor={hrefFor} />
      )}
    </div>
  )
}

function StationList({
  stations,
  frequent,
  onPick,
  hrefFor,
}: {
  stations: Station[]
  frequent: boolean
  onPick?: (s: Station) => void
  hrefFor?: (s: Station) => string
}) {
  const Icon = frequent ? History : MapPin
  return (
    <ul className="divide-y overflow-hidden rounded-lg ring-1 ring-foreground/10">
      {stations.map((s) => {
        const content = (
          <>
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            <span>{s.name}</span>
          </>
        )
        const cls =
          "flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted active:bg-muted"
        return (
          <li key={s.id} className="flex items-center">
            {hrefFor ? (
              <a href={hrefFor(s)} className={cls} onClick={() => onPick?.(s)}>
                {content}
              </a>
            ) : (
              <button type="button" className={cls} onClick={() => onPick?.(s)}>
                {content}
              </button>
            )}
            {/* Frequent rows: X takes the station off the list (a sibling, never inside the link). */}
            {frequent && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 rounded-none text-muted-foreground"
                aria-label={`${s.name} eltávolítása a gyakran keresettek közül`}
                title="Eltávolítás"
                onClick={() => forgetStation(s.id)}
              >
                <X aria-hidden />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
