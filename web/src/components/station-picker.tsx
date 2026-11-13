// Station search input with a result list. Used on the station search and route form screens.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { MapPin, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { api, errorMessage } from "@/lib/api"
import { loadStationList, onStationListLoaded, searchStationsLocal, stationList } from "@/lib/stations"
import type { Station, StationsResponse } from "@/lib/types"

/** Server search results kept in memory (only used until the station list has loaded). */
const resultCache = new Map<string, Station[]>()

/**
 * Station search. With the station list loaded (normally right after start-up): instant,
 * in memory, no request per keystroke. Until then: debounced server search.
 * stations = null while the query is too short.
 */
export function useStationSearch(query: string): { stations: Station[] | null; error: string | null } {
  const [result, setResult] = useState<{ q: string; stations: Station[] | null; error: string | null }>({
    q: "",
    stations: null,
    error: null,
  })
  const q = query.trim()
  const local = useSyncExternalStore(onStationListLoaded, stationList)
  const localResults = useMemo(() => (local && q.length >= 2 ? searchStationsLocal(local, q) : null), [local, q])

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

  if (q.length < 2) return { stations: null, error: null }
  if (localResults) return { stations: localResults, error: null }
  const cached = resultCache.get(q)
  if (cached) return { stations: cached, error: null }
  if (result.q !== q) return { stations: null, error: null }
  return { stations: result.stations, error: result.error }
}

export function SearchInput({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string
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

/** Result list: links (station search) or buttons (route form). */
export function StationResults({
  stations,
  error,
  onPick,
  hrefFor,
}: {
  stations: Station[] | null
  error: string | null
  onPick?: (s: Station) => void
  hrefFor?: (s: Station) => string
}) {
  if (error) return <p className="px-1 text-sm text-destructive">{error}</p>
  if (stations === null) return null
  if (stations.length === 0) return <p className="px-1 text-sm text-muted-foreground">Nincs találat.</p>
  return (
    <ul className="divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
      {stations.map((s) => {
        const content = (
          <>
            <MapPin className="size-4 text-muted-foreground" aria-hidden />
            <span>{s.name}</span>
          </>
        )
        const cls = "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted active:bg-muted"
        return (
          <li key={s.id}>
            {hrefFor ? (
              <a href={hrefFor(s)} className={cls}>
                {content}
              </a>
            ) : (
              <button type="button" className={cls} onClick={() => onPick?.(s)}>
                {content}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
