import { useEffect, useRef } from "react"

/** Touch must start this close to the left edge (px). */
const EDGE = 30
/** Minimum rightward travel (px) that counts as a swipe back. */
const DISTANCE = 80

/**
 * Swipe right from the left edge = Back, like Safari's own gesture. Only in the iPhone/iPad
 * home-screen app (navigator.standalone): iOS has no swipe-back there. In Safari itself and on
 * Android the browser or system already does Back via history, so this stays off to avoid
 * going back twice.
 */
export function useEdgeSwipeBack(onBack: () => void) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (!standalone) return

    let start: { x: number; y: number } | null = null
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      start = e.touches.length === 1 && t && t.clientX <= EDGE ? { x: t.clientX, y: t.clientY } : null
    }
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      if (!start || !t) return
      const dx = t.clientX - start.x
      const dy = Math.abs(t.clientY - start.y)
      start = null
      // Mostly sideways, far enough: Back.
      if (dx >= DISTANCE && dy < dx / 2) onBackRef.current()
    }
    const onCancel = () => {
      start = null
    }
    document.addEventListener("touchstart", onStart, { passive: true })
    document.addEventListener("touchend", onEnd, { passive: true })
    document.addEventListener("touchcancel", onCancel, { passive: true })
    return () => {
      document.removeEventListener("touchstart", onStart)
      document.removeEventListener("touchend", onEnd)
      document.removeEventListener("touchcancel", onCancel)
    }
  }, [])
}
