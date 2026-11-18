import { useCallback } from "react"
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
import type { TimeInfo, Trip } from "@/lib/types"

export function TrainScreen({ tripId, date }: { tripId: string; date: string }) {
  const load = useCallback(
    (signal: AbortSignal) => api<Trip>(`/api/train/${encodeURIComponent(tripId)}?date=${date}`, signal),
    [tripId, date],
  )
  const live = useLiveData(`train:${tripId}:${date}`, load)
  const { error, dataTime, savedAt, refreshError } = live
  const t = live.data

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
            {t.stops.map((s) => (
              <TableRow key={s.sequence} className={cn(s.passed && "text-muted-foreground")}>
                <TableCell className="pl-4 whitespace-normal">
                  <a href={href.board(s.stationId)} className="font-medium underline-offset-4 hover:underline">
                    {s.name}
                  </a>
                  {s.cancelled && <span className="block text-xs font-semibold text-destructive">törölve</span>}
                </TableCell>
                <TimeCell time={s.arrival} cancelled={s.cancelled} showLive={showLive} />
                <TimeCell time={s.departure} cancelled={s.cancelled} showLive={showLive} />
                <TableCell className="pr-4 text-right">{s.platform ?? ""}</TableCell>
              </TableRow>
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
