import { useEffect, useMemo } from "react"
import { ArrowLeftRight, ChevronRight, Search } from "lucide-react"

import { FavoriteButton } from "@/components/favorite-button"
import { RouteArrow, RouteName } from "@/components/route-arrow"
import { Screen, ScreenList, ScreenSection, ScreenSkeleton } from "@/components/layout"
import { DelayReason, DelayText, LiveStatus, TimeBlock, TrainBadge } from "@/components/train-bits"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { setKept } from "@/hooks/use-kept-state"
import { useLiveData } from "@/hooks/use-live-data"
import { routeRequest } from "@/lib/screen-requests"
import { writeLastRoute } from "@/lib/last-route"
import { durationText, platformText, timeParts } from "@/lib/format"
import { href } from "@/lib/router"
import type { Connection, Leg } from "@/lib/types"

export function RouteResultsScreen({ from, to, time }: { from: string; to: string; time: string | null }) {
  const req = useMemo(() => routeRequest(from, to, time), [from, to, time])
  const live = useLiveData(req.key, req.load)
  const { error, dataTime, savedAt, refreshError } = live
  const data = live.data

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
        title={<RouteName from={data.from.name} to={data.to.name} />}
        description={time ? `Indulás ${time} után` : undefined}
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
        <LiveStatus
          live={data.live}
          dataTime={dataTime}
          savedAt={savedAt}
          refreshError={refreshError}
        />
      </ScreenSection>
      {data.connections.length === 0 ? (
        <ScreenSection>
          <p className="text-sm text-muted-foreground">Nincs közvetlen vonat a következő 24 órában</p>
        </ScreenSection>
      ) : (
        <ScreenList>
          {data.connections.map((c) => (
            <ConnectionRow key={`${c.tripId}:${c.serviceDate}:${c.arrival.planned}`} c={c} showLive={showLive} />
          ))}
        </ScreenList>
      )}
    </Screen>
  )
}

/**
 * One train: [badge] departure  arrival  duration  >
 *                    expected   expected (small, red late / green on time)
 *                    then the delay reason, if any. Badge and arrow are centred on the card.
 */
function ConnectionRow({ c, showLive }: { c: Connection; showLive: boolean }) {
  const legs = c.legs && c.legs.length > 1 ? c.legs : null
  // Stretched link: the <a> covers the whole row (after:inset-0), the badge button sits
  // above it (z-10), so tapping the badge shows its popup and anywhere else opens the train.
  return (
    // Badge and arrow are centred on the whole card, including the delay reason line.
    <li className="relative flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted">
      {/* Trips with changes show every train's badge in their leg list instead. */}
      <div className="flex w-14 shrink-0 items-center justify-center">{!legs && <TrainBadge label={c.label} />}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <a
          href={href.train(c.tripId, c.serviceDate)}
          aria-label={`${c.label ?? "Vonat"}, indulás ${c.departure.planned.slice(11, 16)}`}
          className="flex min-w-0 items-center gap-3 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          <TimeBlock time={c.departure} cancelled={c.cancelled} showLive={showLive} />
          <TimeBlock time={c.arrival} cancelled={c.cancelled} showLive={showLive} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm leading-tight">
            <span className="text-muted-foreground">{durationText(c.durationMin)}</span>
            {legs && <span className="text-xs text-muted-foreground">{legs.length - 1} átszállás</span>}
            {(showLive || c.cancelled) && <DelayText
                time={{ ...c.departure, delayMin: c.currentDelayMin ?? c.departure.delayMin }}
                cancelled={c.cancelled}
                className="text-xs"
              />}
            {c.fromPlatform && <span className="text-xs text-muted-foreground">{platformText(c.fromPlatform)}</span>}
          </div>
        </a>
        {legs && <LegList legs={legs} />}
        <DelayReason reason={c.reason} />
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </li>
  )
}

/**
 * The trains of a trip with changes: badge, departure and station, arrival and station, and
 * the change time between them. Each train links to its own train screen; the list sits above
 * the row's stretched link (z-10), and the badge is never inside a link.
 */
function LegList({ legs }: { legs: Leg[] }) {
  return (
    <ol className="relative z-10 flex flex-col gap-1.5 text-xs tabular-nums">
      {legs.map((l, i) => {
        const next = legs[i + 1]
        const wait = next ? Math.round((Date.parse(next.departure.planned) - Date.parse(l.arrival.planned)) / 60000) : 0
        return (
          <li key={`${l.tripId}:${i}`} className="flex flex-col gap-1.5">
            <span className="flex min-w-0 items-start gap-2">
              <TrainBadge label={l.label} />
              <a href={href.train(l.tripId, l.serviceDate)} className="min-w-0 flex-1 leading-snug underline-offset-4 hover:underline">
                {timeParts(l.departure.planned).time} {l.from.name} <RouteArrow /> {timeParts(l.arrival.planned).time} {l.to.name}
              </a>
            </span>
            {next && (
              <span className="text-muted-foreground">
                Átszállás: {l.to.name}, {wait} perc
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
