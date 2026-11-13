import { useCallback, useEffect } from "react"
import { ArrowLeftRight, ChevronRight, Search } from "lucide-react"

import { FavoriteButton } from "@/components/favorite-button"
import { Screen, ScreenList, ScreenSection, ScreenSkeleton } from "@/components/layout"
import { DelayReason, DelayText, LiveStatus, TimeBlock } from "@/components/train-bits"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { setKept } from "@/hooks/use-kept-state"
import { useLiveData } from "@/hooks/use-live-data"
import { api } from "@/lib/api"
import { writeLastRoute } from "@/lib/last-route"
import { durationText, platformText, timeParts } from "@/lib/format"
import { href } from "@/lib/router"
import type { Connection, RouteResponse } from "@/lib/types"

export function RouteResultsScreen({ from, to, time }: { from: string; to: string; time: string | null }) {
  const load = useCallback(
    (signal: AbortSignal) => {
      const q = new URLSearchParams({ from, to, limit: "15" })
      if (time) q.set("time", time)
      return api<RouteResponse>(`/api/route?${q}`, signal)
    },
    [from, to, time],
  )
  const { data, error, dataTime, savedAt, refreshError } = useLiveData(`route:${from}:${to}:${time}`, load)

  // The route last looked at (form, Visszaút or a favorite) becomes the form's stations.
  const fromStation = data?.from
  const toStation = data?.to
  useEffect(() => {
    if (!fromStation || !toStation) return
    writeLastRoute({ from: fromStation, to: toStation })
    setKept("route-form:from", fromStation)
    setKept("route-form:to", toStation)
  }, [fromStation, toStation])

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
        title={`${data.from.name} → ${data.to.name}`}
        description={time ? `Indulás ${time} után` : "Következő közvetlen vonatok"}
        actions={
          <>
            <FavoriteButton favorite={{ type: "route", from: data.from, to: data.to }} />
            <Button asChild variant="outline">
              <a href={href.route(data.to.id, data.from.id)}>
                <ArrowLeftRight aria-hidden />
                Visszaút
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href={href.routeForm()}>
                <Search aria-hidden />
                Új keresés
              </a>
            </Button>
          </>
        }
    >
      <ScreenSection>
        <LiveStatus live={data.live} dataTime={dataTime} savedAt={savedAt} refreshError={refreshError} />
      </ScreenSection>
      {data.connections.length === 0 ? (
        <ScreenSection>
          <p className="text-sm text-muted-foreground">Nincs közvetlen vonat a következő 24 órában.</p>
        </ScreenSection>
      ) : (
        <ScreenList>
          {data.connections.map((c) => (
            <ConnectionRow key={`${c.tripId}:${c.serviceDate}`} c={c} showLive={showLive} />
          ))}
        </ScreenList>
      )}
    </Screen>
  )
}

function ConnectionRow({ c, showLive }: { c: Connection; showLive: boolean }) {
  const arr = timeParts(c.arrival.planned)
  const arrExpected = c.arrival.expected && (c.arrival.delayMin ?? 0) > 0 ? timeParts(c.arrival.expected) : null
  return (
    <li>
      <a
        href={href.train(c.tripId, c.serviceDate)}
        className="flex min-h-14 items-start gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted"
      >
        <TimeBlock time={c.departure} cancelled={c.cancelled} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={c.cancelled ? "font-medium text-muted-foreground line-through" : "font-medium"}>
            → {arr.time}
            {arr.day && <span className="font-normal text-muted-foreground"> ({arr.day})</span>}
            {arrExpected && <span className="text-destructive"> · várható {arrExpected.time}</span>}
            <span className="font-normal text-muted-foreground"> · {durationText(c.durationMin)}</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {c.label && <Badge variant="outline">{c.label}</Badge>}
            {c.fromPlatform && <span>{platformText(c.fromPlatform)}</span>}
          </div>
          <DelayReason reason={c.reason} />
        </div>
        <div className="flex items-center gap-1 pt-0.5 text-sm">
          {(showLive || c.cancelled) && <DelayText time={c.departure} cancelled={c.cancelled} />}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </div>
      </a>
    </li>
  )
}
