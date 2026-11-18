// Favourites load in the background when the app starts, so opening one shows its
// trains (with live delays) at once instead of a loading placeholder.
//
// Live API rule (CLAUDE.md, owner's exception): at most MAX favourites, one request after
// another, once per app start, and only while online. The server's 45 s cache means
// opening a preloaded favourite soon after costs MÁV nothing extra.

import { prefetchLiveData } from "../hooks/use-live-data"
import { readFavorites, type Favorite } from "./favorites"
import { boardRequest, routeRequest, type ScreenRequest } from "./screen-requests"

export const MAX = 5
/** Let the screen the app opens on load first. */
const START_DELAY_MS = 1500

export function favoriteRequest(f: Favorite): ScreenRequest<unknown> {
  return f.type === "station" ? boardRequest(f.id) : routeRequest(f.from.id, f.to.id, null)
}

/** The requests the preload makes: the first MAX favourites, as listed. */
export function prefetchPlan(favorites: Favorite[]): ScreenRequest<unknown>[] {
  return favorites.slice(0, MAX).map(favoriteRequest)
}

let started = false

/** Call once at start-up. */
export function prefetchFavorites(): void {
  if (started) return
  started = true
  window.setTimeout(async () => {
    for (const req of prefetchPlan(readFavorites())) {
      if (!navigator.onLine) return
      await prefetchLiveData(req.key, req.load) // never throws; one at a time
    }
  }, START_DELAY_MS)
}
