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

// In-app history depth, kept in history.state so it survives back/forward and reloads:
// 0 = the first page opened in this tab, +1 for every page opened from there.
function historyDepth(): number {
  const s = window.history.state as { mavyDepth?: unknown } | null
  return typeof s?.mavyDepth === "number" ? s.mavyDepth : -1
}

let lastDepth = 0

/** Call once at start-up: numbers the history entries the app creates (see canGoBack). */
export function trackHistoryDepth() {
  if (historyDepth() < 0) window.history.replaceState({ mavyDepth: 0 }, "")
  lastDepth = historyDepth()
  window.addEventListener("hashchange", () => {
    // A link click makes a new entry without state; back/forward restore the stored depth.
    if (historyDepth() < 0) window.history.replaceState({ mavyDepth: lastDepth + 1 }, "")
    lastDepth = historyDepth()
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
    window.history.pushState({ mavyDepth: lastDepth + 1 }, "", target)
    window.dispatchEvent(new HashChangeEvent("hashchange"))
  })
}

/** True when the previous history entry is a page of this app. */
export function canGoBack(): boolean {
  return historyDepth() > 0
}

/** Back: the previous page of the app, or else `fallback` (replacing the current entry). */
export function navigateBack(fallback: string | null) {
  if (canGoBack()) {
    window.history.back()
  } else if (fallback) {
    window.history.replaceState({ mavyDepth: Math.max(historyDepth(), 0) }, "", fallback)
    window.dispatchEvent(new HashChangeEvent("hashchange"))
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash)
}
