// Small building blocks shared by the board, route and train screens.

import { AlertTriangle, CircleAlert, CloudOff, Radio, WifiOff } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { clock, delayStatus, liveText, savedLabel, timeParts } from "@/lib/format"
import type { LiveInfo, TimeInfo } from "@/lib/types"

/** Delay as red text ('+12 perc', 'törölve'), neutral for 'időben' / 'nincs adat'. */
export function DelayText({
  time,
  cancelled,
  className,
}: {
  time: TimeInfo | null | undefined
  cancelled: boolean
  className?: string
}) {
  const s = delayStatus(time, cancelled)
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        s.kind === "late" || s.kind === "cancelled" ? "text-destructive" : "text-muted-foreground",
        s.strong && "font-semibold",
        className,
      )}
    >
      {s.text}
    </span>
  )
}

/** Why the train is late or cancelled, when the live source says so. */
export function DelayReason({ reason, className }: { reason: string | null | undefined; className?: string }) {
  if (!reason) return null
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-destructive", className)}>
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Ok: </span>
        {reason}
      </span>
    </p>
  )
}

/** Planned time, with 'holnap' / date under it when not today. Struck through when a later time is expected. */
export function TimeBlock({ time, cancelled }: { time: TimeInfo; cancelled: boolean }) {
  const planned = timeParts(time.planned)
  const late = !cancelled && time.expected !== null && (time.delayMin ?? 0) > 0
  return (
    <div className="flex w-14 shrink-0 flex-col leading-tight tabular-nums">
      <span className={cn("text-base font-semibold", (late || cancelled) && "text-muted-foreground line-through")}>
        {planned.time}
      </span>
      {late && <span className="text-base font-semibold text-destructive">{timeParts(time.expected).time}</span>}
      {planned.day && <span className="text-xs text-muted-foreground">{planned.day}</span>}
    </div>
  )
}

/**
 * Where the shown data comes from: live delays, an old copy, or planned times only.
 * Also reports offline copies and failed refreshes.
 */
export function LiveStatus({
  live,
  dataTime,
  savedAt,
  refreshError,
}: {
  live: LiveInfo
  dataTime: number | null
  savedAt: number | null
  refreshError: { at: number; message: string } | null
}) {
  return (
    <div className="flex flex-col gap-2">
      {savedAt !== null && (
        <Alert>
          <WifiOff aria-hidden />
          <AlertTitle>Nincs kapcsolat a szerverrel</AlertTitle>
          <AlertDescription>Mentett adat látható ({savedLabel(savedAt)}).</AlertDescription>
        </Alert>
      )}
      {refreshError && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>A frissítés nem sikerült ({clock(refreshError.at)})</AlertTitle>
          <AlertDescription>{refreshError.message}</AlertDescription>
        </Alert>
      )}
      {live.state === "none" && savedAt === null && (
        <Alert>
          <CloudOff aria-hidden />
          <AlertTitle>Nincs élő késésadat</AlertTitle>
          <AlertDescription>
            A menetrend szerinti idők láthatók. Késés és késési ok csak élő adatforrással jelenik meg.
          </AlertDescription>
        </Alert>
      )}
      {(live.state !== "none" || savedAt !== null) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Radio className={cn("size-3.5", live.state === "live" && savedAt === null && "text-foreground")} aria-hidden />
          {savedAt !== null ? `Az élő adat nem friss (utoljára ${clock(savedAt)})` : liveText(live)}
          {dataTime !== null && savedAt === null && ` · Frissítve ${clock(dataTime)}`}
        </p>
      )}
    </div>
  )
}
