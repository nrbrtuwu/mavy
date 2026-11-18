import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** "From → To" arrow as a Lucide icon sized to the text (the "→" glyph does not match Geist). */
export function RouteArrow({ className }: { className?: string }) {
  return (
    <>
      <ArrowRight aria-hidden className={cn("inline-block size-[0.9em] shrink-0 align-[-0.1em]", className)} />
      <span className="sr-only">→</span>
    </>
  )
}

/** "Alsógalla → Győr" with the icon arrow. */
export function RouteName({ from, to }: { from: string; to: string }) {
  return (
    <>
      {from} <RouteArrow /> {to}
    </>
  )
}
