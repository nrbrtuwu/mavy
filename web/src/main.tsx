import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { App } from "./App"
import { loadStationList } from "./lib/stations"

// Station names for instant search, fetched once at start-up (in the background).
void loadStationList()

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
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // not available (e.g. plain http): the app still works online
  })
}
