import { useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "cn"

import { FavoriteButton } from "@/components/favorite-button"
import { Screen, ScreenList, ScreenSection, ScreenSkeleton } from "@/components/layout"
import { DelayReason, DelayText, LiveStatus, TimeBlock, TrainBadge } from "@/components/train-bits"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useLiveData } from "@/hooks/use-live-data"
import { boardRequest } from "@/lib/screen-requests"
import { platformText } from "@/lib/format"
import { href } from "@/lib/router"
import type { Departure } from "@/lib/types"

export function BoardScreen({ stationId }: { stationId: string }) {
  const req = useMemo(() => boardRequest(stationId), [stationId])
  const live = useLiveData(req.key, req.load)
  const { error, dataTime, savedAt, refreshError } = live
  const data = live.data

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!data) return <ScreenSkeleton />

  const showLive = data.live.state !== "none"
  return (
    <Screen
      title={data.station.name}
      actions={<FavoriteButton favorite={{ type: "station", id: data.station.id, name: data.station.name }} />}
    >
      <ScreenSection>
        <LiveStatus
          live={data.live}
          dataTime={dataTime}
          savedAt={savedAt}
          refreshError={refreshError}
        />
      </ScreenSection>
      {data.departures.length === 0 ? (
        <ScreenSection>
          <p className="text-sm text-muted-foreground">A következő 24 órában nem indul innen vonat</p>
        </ScreenSection>
      ) : (
        <ScreenList>
          {data.departures.map((d) => (
            <DepartureRow key={`${d.tripId}:${d.serviceDate}`} d={d} stationId={data.station.id} showLive={showLive} />
          ))}
        </ScreenList>
      )}
    </Screen>
  )
}

function DepartureRow({ d, stationId, showLive }: { d: Departure; stationId: string; showLive: boolean }) {
  // Stretched link: the headsign <a> covers the whole row (after:inset-0), the badge button
  // sits above it (z-10), so tapping the badge shows its popup and anywhere else opens the train.
  return (
    // Vertically centred: the time, the headsign/badge block and the arrow line up in the middle.
    <li className="relative flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted">
      <TimeBlock time={d.departure} cancelled={d.cancelled} showLive={showLive} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <a
          href={href.train(d.tripId, d.serviceDate, stationId)}
          className={cn(
            "font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring",
            d.cancelled && "text-muted-foreground line-through",
          )}
        >
          {d.headsign ?? "–"}
        </a>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <TrainBadge label={d.label} />
          {d.platform && <span>{platformText(d.platform)}</span>}
        </div>
        <DelayReason reason={d.reason} />
      </div>
      <div className="flex items-center gap-1 text-sm">
        {(showLive || d.cancelled) && <DelayText time={{ ...d.departure, delayMin: d.currentDelayMin ?? d.departure.delayMin }} cancelled={d.cancelled} />}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </div>
    </li>
  )
}
