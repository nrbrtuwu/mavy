import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { App } from "./App"
import { interceptAppLinks, trackHistoryDepth } from "./lib/router"
import { prefetchFavorites } from "./lib/prefetch-favorites"
import { loadStationList } from "./lib/stations"

// Lets the Back button and swipe know whether the previous page belongs to the app.
trackHistoryDepth()
// In-app links switch screens without a browser navigation (no flash in iPhone Safari).
interceptAppLinks()

// Station names for instant search, fetched once at start-up (in the background).
void loadStationList()

// Favourites (up to 5) load in the background, so opening one is instant.
prefetchFavorites()

// Light / dark mode follows the device setting (shadcn uses the .dark class).
const dark = window.matchMedia("(prefers-color-scheme: dark)")
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches)
applyTheme()
dark.addEventListener("change", applyTheme)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker: offline app shell and last saved data. Needs HTTPS (or localhost).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // A new version took over (sw.js skipWaiting + clients.claim): this tab still runs the
  // old code, so reload once. Not on the first install (no previous controller).
  if (navigator.serviceWorker.controller) {
    let reloading = false
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
  }
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // not available (e.g. plain http): the app still works online
  })
}
