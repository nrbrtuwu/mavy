// Animated background: the fogya-tech project's two MeshGradient layers
// (@paper-design/shaders-react), with the colours swapped for greys of the same
// brightness, and limits so it runs well on weak machines too.
//
// fogya-tech:  layer 1  colours #000 #8b5cf6 #fff #1e1b4b #4c1d95, speed 0.3
//              layer 2  colours #000 #fff #8b5cf6 #000, speed 0.2, opacity 60%
//              (its wireframe / backgroundColor props did not exist in the library and were ignored)
// Mávy:        same layers and speeds, greys instead of purples, inverted in light mode.
//
// Performance:
// - The library renders at least at 2x pixel density and up to ~8 M pixels per layer by
//   default. Here: 1x density at most, and a pixel budget per layer (smooth gradients
//   look the same when the browser scales them up).
// - The library pauses each layer while the tab is hidden or the element is off screen.
// - prefers-reduced-motion: a still frame (speed 0).
//
// Banding: dark greys have few 8-bit steps, so a smooth gradient shows as contour lines
// ("jagged lines"). A faint grain (the library's grainOverlay, a fixed noise pattern, not
// animated) dithers the steps away. Strong enough to break up bands, too faint to see as grain.
//
// Placement (iOS 26 Safari, tested on the owner's iPhone with test pages):
// - position: fixed content is never drawn under Safari's floating bottom toolbar; Safari
//   paints a solid bar there (coloured from a fixed bottom-edge element or the page).
// - Normal page content that reaches below the screen IS drawn under the toolbar, also when
//   the page cannot scroll.
// So this is ordinary content (position: absolute, inset-0 of <body>), and <body> is taller
// than the screen and does not scroll (index.css). It stays put and reaches under the toolbar.
// The app scrolls in its own area (AppShell). No fixed elements at the bottom edge.

import { useSyncExternalStore } from "react"
import { MeshGradient } from "@paper-design/shaders-react"

const PIXEL_BUDGET = 600_000 // per layer, ~ a 1000x600 canvas
const MIN_PIXEL_RATIO = 1
/** Dithering against banding (0 to 1). */
const GRAIN = 0.12
/** Black layer over the gradients: higher = darker background. */
const DIM = { dark: 0.65, light: 0.25 }

/** Average grey of the dimmed animation: shown before WebGL starts or if it is unavailable. */
const AVERAGE = { dark: "#212121", light: "#787878" }

const PALETTES = {
  dark: {
    background: AVERAGE.dark,
    base: ["#000000", "#7b7b7b", "#ffffff", "#1e1e1e", "#3c3c3c"],
    overlay: ["#000000", "#ffffff", "#7b7b7b", "#000000"],
  },
  light: {
    background: AVERAGE.light,
    base: ["#ffffff", "#848484", "#000000", "#e1e1e1", "#c3c3c3"],
    overlay: ["#ffffff", "#000000", "#848484", "#ffffff"],
  },
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query)
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

export function AnimatedBackground() {
  const dark = useMediaQuery("(prefers-color-scheme: dark)")
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  const palette = dark ? PALETTES.dark : PALETTES.light
  const motion = reducedMotion ? 0 : 1

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={{ backgroundColor: palette.background }}
    >
      <MeshGradient
        className="absolute inset-0 size-full"
        colors={palette.base}
        speed={0.3 * motion}
        minPixelRatio={MIN_PIXEL_RATIO}
        maxPixelCount={PIXEL_BUDGET}
        grainOverlay={GRAIN}
        webGlContextAttributes={{ antialias: false, powerPreference: "low-power" }}
      />
      <MeshGradient
        className="absolute inset-0 size-full opacity-60"
        colors={palette.overlay}
        speed={0.2 * motion}
        minPixelRatio={MIN_PIXEL_RATIO}
        maxPixelCount={PIXEL_BUDGET}
        grainOverlay={GRAIN}
        webGlContextAttributes={{ antialias: false, powerPreference: "low-power" }}
      />
      <div className="absolute inset-0 bg-black" style={{ opacity: dark ? DIM.dark : DIM.light }} />
    </div>
  )
}
