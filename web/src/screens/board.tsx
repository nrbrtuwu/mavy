import { useCallback } from "react"
import { ChevronRight } from "lucide-react"

import { FavoriteButton } from "@/components/favorite-button"
import { ListSkeleton, PageHeader } from "@/components/layout"
import { DelayReason, DelayText, LiveStatus, TimeBlock } from "@/components/train-bits"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { useLiveData } from "@/hooks/use-live-data"
import { api } from "@/lib/api"
import { platformText } from "@/lib/format"
import { href } from "@/lib/router"
import type { BoardResponse, Departure } from "@/lib/types"

export function BoardScreen({ stationId }: { stationId: string }) {
  const load = useCallback(
    (signal: AbortSignal) =>
      api<BoardResponse>(`/api/departures?station=${encodeURIComponent(stationId)}&limit=30`, signal),
    [stationId],
  )
  const { data, error, dataTime, savedAt, refreshError } = useLiveData(`board:${stationId}`, load)

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!data) return <ListSkeleton />

  const showLive = data.live.state !== "none"
  return (
    <>
      <PageHeader
        title={data.station.name}
        description="Induló vonatok"
        actions={<FavoriteButton favorite={{ type: "station", id: data.station.id, name: data.station.name }} />}
      />
      <LiveStatus live={data.live} dataTime={dataTime} savedAt={savedAt} refreshError={refreshError} />
      {data.departures.length === 0 ? (
        <p className="text-sm text-muted-foreground">A következő 24 órában nem indul innen vonat.</p>
      ) : (
        <Card className="py-0">
          <ul className="divide-y">
            {data.departures.map((d) => (
              <DepartureRow key={`${d.tripId}:${d.serviceDate}`} d={d} showLive={showLive} />
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function DepartureRow({ d, showLive }: { d: Departure; showLive: boolean }) {
  return (
    <li>
      <a
        href={href.train(d.tripId, d.serviceDate)}
        className="flex min-h-14 items-start gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted"
      >
        <TimeBlock time={d.departure} cancelled={d.cancelled} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={d.cancelled ? "font-medium text-muted-foreground line-through" : "font-medium"}>
            {d.headsign ?? "–"}
          </span>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {d.label && <Badge variant="outline">{d.label}</Badge>}
            {d.platform && <span>{platformText(d.platform)}</span>}
          </div>
          <DelayReason reason={d.reason} />
        </div>
        <div className="flex items-center gap-1 pt-0.5 text-sm">
          {(showLive || d.cancelled) && <DelayText time={d.departure} cancelled={d.cancelled} />}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </div>
      </a>
    </li>
  )
}
