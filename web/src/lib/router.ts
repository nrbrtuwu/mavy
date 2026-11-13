// Hash router (no dependency). Routes:
//   #/                          start page (chosen in settings, default: route search)
//   #/kedvencek                 favorites
//   #/beallitasok               settings (last navbar item)
//   #/allomas                   station search
//   #/tabla/{stationId}         departure board
//   #/utvonal                   route search form
//   #/utvonal/{from}/{to}?ido=  route results
//   #/vonat/{tripId}/{date}     train detail

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
  | { name: "train"; tripId: string; date: string }
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
  if ((m = /^#\/vonat\/([^/?]+)\/(\d{8})$/.exec(h))) return { name: "train", tripId: dec(m[1]!), date: m[2]! }
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
  train: (tripId: string, date: string) => `#/vonat/${enc(tripId)}/${date}`,
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash)
}
