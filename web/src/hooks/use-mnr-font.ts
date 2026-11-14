import { useSyncExternalStore } from "react"

// Whether MÁV's badge font (web/public/fonts/MNR2007.ttf, fetched with `bun run fetch-font`,
// not in git) is there. Without it the badge code points would show as stray letters (ǚ …),
// so TrainBadge falls back to text badges. "loading" still draws glyphs: the font uses
// font-display: block, so nothing wrong is visible while it loads.

type State = "loading" | "ok" | "missing"

let state: State = "loading"
const listeners = new Set<() => void>()
let started = false

function start() {
  if (started || typeof document === "undefined" || !document.fonts) return
  started = true
  // U+014F is one of the badges (S10); load() resolves with the faces that cover it.
  document.fonts
    .load("22px MNR", "ŏ")
    .then((faces) => (faces.some((f) => f.family.replace(/"/g, "") === "MNR" && f.status === "loaded") ? "ok" : "missing"))
    .catch(() => "missing" as const)
    .then((s) => {
      state = s
      listeners.forEach((l) => l())
    })
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** False once it is clear the MNR2007 font could not be loaded. */
export function useMnrFont(): boolean {
  return useSyncExternalStore(subscribe, () => state) !== "missing"
}
