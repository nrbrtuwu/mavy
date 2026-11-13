import { useCallback } from "react"
import { cn } from "cn"

import { ListSkeleton, PageHeader } from "@/components/layout"
import { DelayReason, DelayText, LiveStatus } from "@/components/train-bits"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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
  const { data: t, error, dataTime, savedAt, refreshError } = useLiveData(`train:${tripId}:${date}`, load)

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!t) return <ListSkeleton rows={8} />

  const showLive = t.live.state !== "none"
  return (
    <>
      <PageHeader
        title={t.headsign ? `→ ${t.headsign}` : (t.label ?? "Vonat")}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {t.label && <Badge variant="outline">{t.label}</Badge>}
            <span>{serviceDateLabel(t.serviceDate)}</span>
          </span>
        }
      />
      <TrainState trip={t} />
      <LiveStatus live={t.live} dataTime={dataTime} savedAt={savedAt} refreshError={refreshError} />
      <Card className="py-0">
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
      </Card>
    </>
  )
}

function TrainState({ trip }: { trip: Trip }) {
  if (trip.cancelled) {
    return (
      <Alert variant="destructive">
        <AlertTitle>A vonat ezen a napon nem közlekedik (törölve).</AlertTitle>
        {trip.reason && <AlertDescription>Ok: {trip.reason}</AlertDescription>}
      </Alert>
    )
  }
  if (!trip.runsOnDate) {
    return (
      <Alert>
        <AlertTitle>A vonat ezen a napon nem közlekedik.</AlertTitle>
      </Alert>
    )
  }
  if (trip.delayMin === null) return null
  return (
    <Card size="sm" className="px-4">
      <p className="text-sm">
        {trip.delayMin > 0 ? (
          <>
            Jelenleg <DelayText time={{ planned: "", expected: null, delayMin: trip.delayMin }} cancelled={false} /> késés
          </>
        ) : (
          "Időben közlekedik."
        )}
      </p>
      <DelayReason reason={trip.reason} />
    </Card>
  )
}

function TimeCell({ time, cancelled, showLive }: { time: TimeInfo | null; cancelled: boolean; showLive: boolean }) {
  if (!time) return <TableCell />
  const p = timeParts(time.planned)
  const late = !cancelled && time.expected !== null && (time.delayMin ?? 0) > 0
  return (
    <TableCell className="align-top tabular-nums">
      <span className={cn(late && "text-muted-foreground line-through")}>{p.time}</span>
      {p.day && <span className="block text-xs text-muted-foreground">{p.day}</span>}
      {late && <span className="block font-semibold text-destructive">{timeParts(time.expected).time}</span>}
      {showLive && !cancelled && <DelayText time={time} cancelled={false} className="block text-xs" />}
    </TableCell>
  )
}
