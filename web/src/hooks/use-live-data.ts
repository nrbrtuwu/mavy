// Loads data for a screen and keeps it fresh: every 60 s while the page is
// visible, right away when it becomes visible again or the device comes back
// online. A failed refresh keeps the old data and reports the failure time.
//
// Results are also kept in memory per key, so going back to a screen shows its last
// data instantly (no loading placeholder) and refreshes it quietly in the background.

import { useCallback, useEffect, useRef, useState } from "react"
import { errorMessage, type Offline } from "@/lib/api"

const REFRESH_MS = 60_000
/** Coming back to a screen within this time: show the kept data without refetching. */
const FRESH_MS = 15_000
/** How many screens' data to keep in memory. */
const CACHE_SIZE = 30

export interface LiveData<T> {
  data: T | null
  /** Error with no data to show. */
  error: string | null
  /** When the shown data was fetched: now, or the save time of an offline copy. */
  dataTime: number | null
  /** Set when the shown data is an offline copy from the service worker. */
  savedAt: number | null
  /** Set when the last refresh failed while older data is still shown. */
  refreshError: { at: number; message: string } | null
}

interface Kept {
  data: unknown
  dataTime: number | null
  savedAt: number | null
  loadedAt: number
}

/** Last result per key, for the lifetime of the page (most recently used last). */
const kept = new Map<string, Kept>()

function keep(key: string, value: Kept) {
  kept.delete(key)
  kept.set(key, value)
  while (kept.size > CACHE_SIZE) kept.delete(kept.keys().next().value!)
}

function fromKept<T>(key: string): LiveData<T> & { key: string } {
  const k = kept.get(key)
  return {
    key,
    data: (k?.data as T | undefined) ?? null,
    error: null,
    dataTime: k?.dataTime ?? null,
    savedAt: k?.savedAt ?? null,
    refreshError: null,
  }
}

export function useLiveData<T>(key: string, load: (signal: AbortSignal) => Promise<T & Offline>): LiveData<T> {
  const [state, setState] = useState<LiveData<T> & { key: string }>(() => fromKept<T>(key))
  const loadRef = useRef(load)
  loadRef.current = load
  const loadedAt = useRef(0)

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await loadRef.current(signal)
      if (signal.aborted) return
      const now = Date.now()
      loadedAt.current = now
      const savedAt = data._savedAt ? Date.parse(data._savedAt) : null
      const dataTime = savedAt ?? now
      keep(key, { data, dataTime, savedAt, loadedAt: now })
      setState({ key, data, error: null, dataTime, savedAt, refreshError: null })
    } catch (err) {
      if (signal.aborted) return
      loadedAt.current = Date.now() // try again after the normal interval
      const message = errorMessage(err)
      setState((s) =>
        s.key === key && s.data !== null
          ? { ...s, refreshError: { at: Date.now(), message } }
          : { key, data: null, error: message, dataTime: null, savedAt: null, refreshError: null },
      )
    }
  }, [key])

  useEffect(() => {
    let controller = new AbortController()
    const run = () => {
      controller.abort()
      controller = new AbortController()
      void refresh(controller.signal)
    }
    // Kept data shows at once; refetch unless it is only a few seconds old.
    loadedAt.current = kept.get(key)?.loadedAt ?? 0
    if (Date.now() - loadedAt.current >= FRESH_MS) run()
    const due = () => document.visibilityState === "visible" && Date.now() - loadedAt.current >= REFRESH_MS
    const timer = window.setInterval(() => due() && run(), 5_000)
    const onVisible = () => due() && run()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", run)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", run)
    }
  }, [key, refresh])

  // Data of a previous key is never shown for a new one (kept data for the new key is).
  if (state.key !== key) return fromKept<T>(key)
  return state
}
