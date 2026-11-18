// User settings, stored on this device (localStorage). The installed PWA uses the
// same storage as the site on Android/desktop; on iOS the home-screen app keeps its own.

import { useSyncExternalStore } from "react"

export type StartPage = "route" | "station" | "favorites"

export interface Settings {
  /** Screen shown when the app opens (#/). */
  startPage: StartPage
  /** Animated shader background on or off. */
  animatedBackground: boolean
}

export const DEFAULT_SETTINGS: Settings = { startPage: "route", animatedBackground: true }

export const START_PAGES: { value: StartPage; label: string; description: string }[] = [
  { value: "route", label: "Útvonal", description: "Keresés két állomás között" },
  { value: "station", label: "Állomás", description: "Indulási tábla keresése" },
  { value: "favorites", label: "Kedvencek", description: "Mentett állomások és útvonalak" },
]

const KEY = "mavy.settings.v1"
const EVENT = "mavy:settings"

/** Parse stored JSON; anything unknown or broken falls back to the defaults. */
export function parseSettings(raw: string | null): Settings {
  try {
    const value = JSON.parse(raw ?? "{}") as {
      startPage?: unknown
      animatedBackground?: unknown
    } | null
    const start = value?.startPage
    const background = value?.animatedBackground
    return {
      startPage: START_PAGES.some((p) => p.value === start) ? (start as StartPage) : DEFAULT_SETTINGS.startPage,
      animatedBackground: typeof background === "boolean" ? background : DEFAULT_SETTINGS.animatedBackground,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

let cacheRaw: string | null | undefined
let cache: Settings = DEFAULT_SETTINGS

function read(): Settings {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    // storage blocked: defaults
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw
    cache = parseSettings(raw)
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }))
  } catch {
    // storage full or blocked: the choice lasts for this session only
  }
  // Ask the browser not to clear this site's storage under pressure (best effort).
  void navigator.storage?.persist?.().catch(() => false)
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read)
}
