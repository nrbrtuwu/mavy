// Hash router (no dependency). Routes:
//   #/                          start page (chosen in settings, default: route search)
//   #/kedvencek                 favorites
//   #/beallitasok               settings (last navbar item)
//   #/allomas                   station search
//   #/tabla/{stationId}         departure board
//   #/utvonal                   route search form
//   #/utvonal/{from}/{to}?ido=  route results
//   #/vonat/{tripId}/{date}?fel=&le=  train detail; fel / le: the station where the user
//                               gets on / off (highlighted), both optional

import { useSyncExternalStore } from "react"
import type { StartPage } from "./settings"

export type Route =
  | { name: "start" }
  | { name: "favorites" }
  | { name: "settings" }
  | { name: "stations" }
  | { name: "board"; id: string }
  | { name: "routeForm" }
  | { name: "route"; from: string; to: string; time: string | null }
  | { name: "train"; tripId: string; date: string; on: string | null; off: string | null }
  | { name: "notFound" }

const enc = encodeURIComponent
const dec = decodeURIComponent

export function parseHash(hash: string): Route {
  const h = hash || "#/"
  let m: RegExpExecArray | null
  if (/^#?\/?$/.test(h)) return { name: "start" }
  if (h === "#/kedvencek") return { name: "favorites" }
  if (h === "#/beallitasok") return { name: "settings" }
  if (h === "#/allomas") return { name: "stations" }
  if ((m = /^#\/tabla\/([^/?]+)$/.exec(h))) return { name: "board", id: dec(m[1]!) }
  if (h === "#/utvonal") return { name: "routeForm" }
  if ((m = /^#\/utvonal\/([^/?]+)\/([^/?]+)(?:\?ido=(\d{2}:\d{2}))?$/.exec(h))) {
    return { name: "route", from: dec(m[1]!), to: dec(m[2]!), time: m[3] ?? null }
  }
  if ((m = /^#\/vonat\/([^/?]+)\/(\d{8})(?:\?(.*))?$/.exec(h))) {
    const q = new URLSearchParams(m[3] ?? "")
    return { name: "train", tripId: dec(m[1]!), date: m[2]!, on: q.get("fel"), off: q.get("le") }
  }
  return { name: "notFound" }
}

/** #/ shows the start page chosen in settings. */
export function resolveStart(route: Route, startPage: StartPage): Route {
  if (route.name !== "start") return route
  if (startPage === "station") return { name: "stations" }
  if (startPage === "favorites") return { name: "favorites" }
  return { name: "routeForm" }
}

export const href = {
  start: () => "#/",
  favorites: () => "#/kedvencek",
  settings: () => "#/beallitasok",
  stations: () => "#/allomas",
  board: (id: string) => `#/tabla/${enc(id)}`,
  routeForm: () => "#/utvonal",
  route: (from: string, to: string, time?: string | null) =>
    `#/utvonal/${enc(from)}/${enc(to)}${time ? `?ido=${time}` : ""}`,
  /** on / off: where the user gets on / off this train (highlighted on the train screen). */
  train: (tripId: string, date: string, on?: string | null, off?: string | null) => {
    const q = new URLSearchParams()
    if (on) q.set("fel", on)
    if (off) q.set("le", off)
    const qs = q.toString()
    return `#/vonat/${enc(tripId)}/${date}${qs ? `?${qs}` : ""}`
  },
}

/**
 * Where Back goes when there is no earlier page in the app (opened from a link, a favorite
 * on a fresh start, …). null for the top-level pages (the navbar items), which get no Back button.
 */
export function parentHref(route: Route): string | null {
  switch (route.name) {
    case "board":
      return href.stations()
    case "route":
      return href.routeForm()
    case "train":
    case "notFound":
      return href.start()
    default:
      return null
  }
}

// ---- Back navigation ---------------------------------------------------------------
//
// Screens come in three levels: 0 = the navbar pages (search forms, favourites, settings),
// 1 = lists (route results, departure board), 2 = a train. Back goes up a level:
//   - from a train: to the screen it was opened from (usually its list);
//   - from a list: to the search page or favourites the user started from, skipping the
//     other lists seen since (Visszaút, an earlier search …);
//   - without such a page in this tab's history: to the parent screen (parentHref).
// Moving from one list to another (Visszaút) replaces the history entry instead of adding
// one, so the browser's / phone's own Back follows the same path.
//
// Every history entry the app makes carries its depth (0 = first page opened in this tab,
// +1 per page opened from there) and the depth of the level-0 page it belongs to (-1: none).

export type Level = 0 | 1 | 2

export function routeLevel(route: Route): Level {
  switch (route.name) {
    case "board":
    case "route":
      return 1
    case "train":
    case "notFound":
      return 2
    default:
      return 0
  }
}

/** An in-app link from `from` to `to` replaces the current entry: list to list. */
export function replacesEntry(from: Route, to: Route): boolean {
  return routeLevel(from) === 1 && routeLevel(to) === 1
}

export interface NavState {
  mavyDepth: number
  /** Depth of the level-0 page this entry was reached from, -1 if none. */
  mavyTop: number
}

/** The history state for `route` at `depth`; `prevTop` is the previous entry's mavyTop. */
export function entryState(route: Route, depth: number, prevTop: number): NavState {
  return { mavyDepth: depth, mavyTop: routeLevel(route) === 0 ? depth : prevTop }
}

export type BackAction = { go: number } | { replace: string } | null

/** What Back does on `route` with the current entry's state (null: nothing, a navbar page). */
export function backAction(route: Route, state: NavState | null): BackAction {
  const level = routeLevel(route)
  if (level === 0) return null
  const depth = state?.mavyDepth ?? 0
  if (level === 1) {
    const top = state?.mavyTop ?? -1
    if (top >= 0 && top < depth) return { go: top - depth }
  } else if (depth > 0) {
    return { go: -1 }
  }
  const parent = parentHref(route)
  return parent ? { replace: parent } : null
}

function currentState(): NavState | null {
  const s = window.history.state as Partial<NavState> | null
  if (typeof s?.mavyDepth !== "number") return null
  return { mavyDepth: s.mavyDepth, mavyTop: typeof s.mavyTop === "number" ? s.mavyTop : -1 }
}

/** State of the entry shown now (updated on every hashchange). */
let last: NavState = { mavyDepth: 0, mavyTop: -1 }

/** Call once at start-up: gives every history entry the app creates its NavState. */
export function trackHistoryDepth() {
  if (!currentState()) {
    window.history.replaceState(entryState(parseHash(window.location.hash), 0, -1), "")
  }
  last = currentState()!
  window.addEventListener("hashchange", () => {
    // A plain hash change (route form submit) makes a new entry without state;
    // back/forward restore the stored one.
    if (!currentState()) {
      const route = parseHash(window.location.hash)
      window.history.replaceState(entryState(route, last.mavyDepth + 1, last.mavyTop), "")
    }
    last = currentState()!
  })
}

/**
 * Call once at start-up: in-app links (`#/…`) change the page with history.pushState
 * instead of a fragment navigation. iPhone Safari treats every link tap as a navigation
 * (toolbar reacts, the whole page repaints and flashes grey for a frame); pushState is not
 * one. The app still listens to "hashchange", so one is dispatched by hand.
 */
export function interceptAppLinks() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.("a")
    const target = a?.getAttribute("href")
    if (!a || !target?.startsWith("#/") || (a.target && a.target !== "_self") || a.hasAttribute("download")) return
    e.preventDefault()
    if (target === window.location.hash) return
    const from = parseHash(window.location.hash)
    const to = parseHash(target)
    if (replacesEntry(from, to)) {
      window.history.replaceState(entryState(to, last.mavyDepth, last.mavyTop), "", target)
    } else {
      window.history.pushState(entryState(to, last.mavyDepth + 1, last.mavyTop), "", target)
    }
    window.dispatchEvent(new HashChangeEvent("hashchange"))
  })
}

/** Back button and swipe: see backAction. */
export function navigateBack() {
  const state = currentState()
  const action = backAction(parseHash(window.location.hash), state)
  if (!action) return
  if ("go" in action) {
    window.history.go(action.go)
    return
  }
  const s = state ?? last
  window.history.replaceState(entryState(parseHash(action.replace), s.mavyDepth, s.mavyTop), "", action.replace)
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash)
}
