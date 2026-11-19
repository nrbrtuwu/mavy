import { Fragment, useCallback, useEffect, useRef } from "react"
import { TrainFront } from "lucide-react"
import { cn } from "cn"

import { RouteArrow } from "@/components/route-arrow"
import { Screen, ScreenSection, ScreenSkeleton } from "@/components/layout"
import { DelayReason, DelayText, ExpectedTime, LiveStatus, TrainBadge } from "@/components/train-bits"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLiveData } from "@/hooks/use-live-data"
import { api } from "@/lib/api"
import { serviceDateLabel, timeParts } from "@/lib/format"
import { href } from "@/lib/router"
import { currentLeg } from "@/lib/train-position"
import type { TimeInfo, Trip } from "@/lib/types"

export function TrainScreen({
  tripId,
  date,
  on = null,
  off = null,
}: {
  tripId: string
  date: string
  /** Station where the user gets on / off (from the route or board they came from). */
  on?: string | null
  off?: string | null
}) {
  const load = useCallback(
    (signal: AbortSignal) => api<Trip>(`/api/train/${encodeURIComponent(tripId)}?date=${date}`, signal),
    [tripId, date],
  )
  const live = useLiveData(`train:${tripId}:${date}`, load)
  const { error, dataTime, savedAt, refreshError } = live
  const t = live.data

  // Where the train is now (live passed stops): a row between two stops.
  const leg = t && t.live.state !== "none" ? currentLeg(t.stops) : null
  // The user's part of the trip: where they get on and off (else the whole run).
  const onIdx = t && on ? t.stops.findIndex((s) => s.stationId === on) : -1
  const offIdx = t && off ? t.stops.findIndex((s, i) => s.stationId === off && i > onIdx) : -1
  const nowRow = useRef<HTMLTableRowElement>(null)
  const onRow = useRef<HTMLTableRowElement>(null)
  const scrolled = useRef(false)
  // Scrolled into view once: where the user gets on, until the train has passed it; then
  // (or without a boarding station) where the train is now.
  useEffect(() => {
    const beforeBoarding = onIdx >= 0 && (leg === null || leg < onIdx)
    const target = beforeBoarding ? onRow.current : (nowRow.current ?? onRow.current)
    if (scrolled.current || !target) return
    scrolled.current = true
    // Only the screen's own scroll area moves (scrollIntoView would also shift the page frame).
    const body = target.closest<HTMLElement>("[data-screen-body]")
    if (!body) return
    const offset = target.getBoundingClientRect().top - body.getBoundingClientRect().top
    body.scrollTop += offset - body.clientHeight / 2 + target.clientHeight / 2
  }, [leg, onIdx])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!t) return <ScreenSkeleton rows={8} />

  const showLive = t.live.state !== "none"
  return (
    <Screen
      title={
        t.headsign ? (
          <>
            <RouteArrow /> {t.headsign}
          </>
        ) : (
          (t.label ?? "Vonat")
        )
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <TrainBadge label={t.label} />
          <span>{serviceDateLabel(t.serviceDate)}</span>
        </span>
      }
    >
      <ScreenSection>
        <TrainState trip={t} />
        <LiveStatus live={t.live} dataTime={dataTime} savedAt={savedAt} refreshError={refreshError} />
      </ScreenSection>
      <div className="border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Állomás</TableHead>
              <TableHead>Érk.</TableHead>
              <TableHead>Ind.</TableHead>
              <TableHead className="pr-4 text-right">Vg.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.stops.map((s, i) => (
              <Fragment key={s.sequence}>
              <TableRow
                ref={i === onIdx ? onRow : undefined}
                className={cn(
                  (s.passed || (onIdx >= 0 && i < onIdx) || (offIdx >= 0 && i > offIdx)) && "text-muted-foreground",
                  (i === onIdx || i === offIdx) && "bg-muted/60 hover:bg-muted/60",
                )}
              >
                <TableCell className="pl-4 whitespace-normal">
                  <a href={href.board(s.stationId)} className="font-medium underline-offset-4 hover:underline">
                    {s.name}
                  </a>
                  {i === onIdx && <span className="block text-xs text-muted-foreground">Felszállás</span>}
                  {i === offIdx && <span className="block text-xs text-muted-foreground">Leszállás</span>}
                  {s.cancelled && <span className="block text-xs font-semibold text-destructive">törölve</span>}
                </TableCell>
                <TimeCell time={s.arrival} cancelled={s.cancelled} showLive={showLive} />
                <TimeCell time={s.departure} cancelled={s.cancelled} showLive={showLive} />
                <TableCell className="pr-4 text-right">{s.platform ?? ""}</TableCell>
              </TableRow>
              {i === leg && (
                <TableRow ref={nowRow} className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-2 pl-4 whitespace-normal">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <TrainFront className="size-3.5" aria-hidden />
                      Most itt jár: {s.name} és {t.stops[i + 1]!.name} között
                    </span>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </Screen>
  )
}

function TrainState({ trip }: { trip: Trip }) {
  if (trip.cancelled) {
    return (
      <Alert variant="destructive">
        <AlertTitle>A vonat ezen a napon nem közlekedik (törölve)</AlertTitle>
        {trip.reason && <AlertDescription>Ok: {trip.reason}</AlertDescription>}
      </Alert>
    )
  }
  if (!trip.runsOnDate) {
    return (
      <Alert>
        <AlertTitle>A vonat ezen a napon nem közlekedik</AlertTitle>
      </Alert>
    )
  }
  if (trip.delayMin === null && !trip.reason) return null
  return (
    <Alert>
      {trip.delayMin !== null && (
        <AlertTitle>
          {trip.delayMin > 0 ? (
            <>
              Jelenleg <DelayText time={{ planned: "", expected: null, delayMin: trip.delayMin }} cancelled={false} /> késés
            </>
          ) : (
            "Időben közlekedik"
          )}
        </AlertTitle>
      )}
      {trip.reason && (
        <AlertDescription>
          <DelayReason reason={trip.reason} />
        </AlertDescription>
      )}
    </Alert>
  )
}

function TimeCell({ time, cancelled, showLive }: { time: TimeInfo | null; cancelled: boolean; showLive: boolean }) {
  if (!time) return <TableCell />
  // Same style as the train cards: planned time, then the small expected time under it.
  const p = timeParts(time.planned)
  const late = !cancelled && (time.delayMin ?? 0) > 0
  return (
    <TableCell className="align-top leading-tight tabular-nums">
      <span className="block">{p.time}</span>
      {p.day && <span className="block text-xs text-muted-foreground">{p.day}</span>}
      {!cancelled && (
        <span className="block">
          <ExpectedTime time={time} cancelled={false} showLive={showLive} />
        </span>
      )}
      {showLive && late && <DelayText time={time} cancelled={false} className="block text-xs" />}
    </TableCell>
  )
}
