// What the board and route screens load, in one place, so the favourites preload
// (lib/prefetch-favorites.ts) fills exactly the cache entries the screens read.

import { api } from "./api"
import type { BoardResponse, RouteResponse } from "./types"

export interface ScreenRequest<T> {
  /** useLiveData cache key. */
  key: string
  load: (signal?: AbortSignal) => ReturnType<typeof api<T>>
}

export function boardRequest(stationId: string): ScreenRequest<BoardResponse> {
  return {
    key: `board:${stationId}`,
    load: (signal) => api<BoardResponse>(`/api/departures?station=${encodeURIComponent(stationId)}&limit=30`, signal),
  }
}

export function routeRequest(from: string, to: string, time: string | null): ScreenRequest<RouteResponse> {
  return {
    key: `route:${from}:${to}:${time}`,
    load: (signal) => {
      const q = new URLSearchParams({ from, to, limit: "15" })
      if (time) q.set("time", time)
      return api<RouteResponse>(`/api/route?${q}`, signal)
    },
  }
}
