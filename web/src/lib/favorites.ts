// Saved stations and routes, stored only on this device (localStorage).

import { useSyncExternalStore } from "react"
import type { Station } from "./types"

export type Favorite = { type: "station"; id: string; name: string } | { type: "route"; from: Station; to: Station }

const KEY = "mavy.favorites.v1"
const EVENT = "mavy:favorites"

export const favId = (f: Favorite) => (f.type === "station" ? `s:${f.id}` : `r:${f.from.id}>${f.to.id}`)
export const favLabel = (f: Favorite) => (f.type === "station" ? f.name : `${f.from.name} → ${f.to.name}`)

let cacheRaw: string | null = null
let cacheList: Favorite[] = []

function read(): Favorite[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    // storage blocked
  }
  if (raw === cacheRaw) return cacheList
  cacheRaw = raw
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]")
    cacheList = Array.isArray(parsed) ? (parsed as Favorite[]) : []
  } catch {
    cacheList = []
  }
  return cacheList
}

function write(list: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage full or blocked: favorites just do not persist
  }
  window.dispatchEvent(new Event(EVENT))
}

/** The saved favourites right now (outside React). */
export function readFavorites(): Favorite[] {
  return read()
}

export function toggleFavorite(f: Favorite): void {
  const list = [...read()]
  const i = list.findIndex((x) => favId(x) === favId(f))
  if (i >= 0) list.splice(i, 1)
  else list.push(f)
  write(list)
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export function useFavorites(): Favorite[] {
  return useSyncExternalStore(subscribe, read)
}
