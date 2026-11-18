import { cn } from "@/lib/utils"

/**
 * The app icon's train front (scripts/make-icons.ts, same 100x100 coordinates) without
 * its black square, in the text colour, so the header logo matches the tab and home-screen
 * icon in light and dark mode. Windscreen and headlights are holes (even-odd fill).
 */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="20 21.5 60 61.5" aria-hidden className={cn("size-5 shrink-0", className)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M30 22h40v50H30z M35 28h30v19H35z M35 60a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0z M58 60a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0z M33 72h7v6h-7z M60 72h7v6h-7z M27 80h46v2.5H27z"
      />
    </svg>
  )
}
