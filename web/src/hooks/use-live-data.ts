// Loads data for a screen and keeps it fresh: every 60 s while the page is
// visible, right away when it becomes visible again or the device comes back
// online. A failed refresh keeps the old data and reports the failure time.

import { useCallback, useEffect, useRef, useState } from "react"
import { errorMessage, type Offline } from "@/lib/api"

const REFRESH_MS = 60_000

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

export function useLiveData<T>(key: string, load: (signal: AbortSignal) => Promise<T & Offline>): LiveData<T> {
  const [state, setState] = useState<LiveData<T> & { key: string }>({
    key,
    data: null,
    error: null,
    dataTime: null,
    savedAt: null,
    refreshError: null,
  })
  const loadRef = useRef(load)
  loadRef.current = load
  const loadedAt = useRef(0)

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await loadRef.current(signal)
      if (signal.aborted) return
      loadedAt.current = Date.now()
      const savedAt = data._savedAt ? Date.parse(data._savedAt) : null
      setState({ key, data, error: null, dataTime: savedAt ?? Date.now(), savedAt, refreshError: null })
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
    loadedAt.current = 0
    run()
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
  }, [refresh])

  // Data of a previous key is never shown for a new one.
  if (state.key !== key) return { data: null, error: null, dataTime: null, savedAt: null, refreshError: null }
  return state
}
