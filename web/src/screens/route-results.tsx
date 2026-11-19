import { useEffect, useMemo, useState } from "react"
import { ArrowLeftRight, ChevronDown, ChevronRight, Search } from "lucide-react"
import { cn } from "cn"

import { FavoriteButton } from "@/components/favorite-button"
import { RouteArrow, RouteName } from "@/components/route-arrow"
import { Screen, ScreenList, ScreenSection, ScreenSkeleton } from "@/components/layout"
import { DelayReason, DelayText, ExpectedTime, LiveStatus, TimeBlock, TrainBadge } from "@/components/train-bits"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { setKept } from "@/hooks/use-kept-state"
import { useLiveData } from "@/hooks/use-live-data"
import { routeRequest } from "@/lib/screen-requests"
import { writeLastRoute } from "@/lib/last-route"
import { durationText, platformText, timeParts } from "@/lib/format"
import { href } from "@/lib/router"
import type { Connection, Leg, TimeInfo } from "@/lib/types"

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
          <p className="text-sm text-muted-foreground">Nincs vonat a következő 24 órában</p>
        </ScreenSection>
      ) : (
        <ScreenList>
          {data.connections.map((c) => (
            <ConnectionRow key={`${c.tripId}:${c.serviceDate}:${c.arrival.planned}`} c={c} showLive={showLive} from={data.from.id} to={data.to.id} />
          ))}
        </ScreenList>
      )}
    </Screen>
  )
}

/**
 * One option: [badge(s)] departure  arrival  duration  >
 *                        expected   expected (small, red late / green on time)
 *                        then the delay reason, if any. Badges and arrow are centred on the card.
 *
 * A direct train opens its train screen (where you get on and off marked). A trip with
 * changes shows only its trains' badges, stacked; tapping it opens its timeline in place.
 */
function ConnectionRow({ c, showLive, from, to }: { c: Connection; showLive: boolean; from: string; to: string }) {
  const [open, setOpen] = useState(false)
  const legs = c.legs && c.legs.length > 1 ? c.legs : null
  const label = `${c.label ?? "Vonat"}, indulás ${c.departure.planned.slice(11, 16)}`
  // Stretched link / button: it covers the whole row (after:inset-0); the badges sit above it
  // (z-10), so tapping a badge shows its popup and anywhere else opens the train or the trip.
  const stretched =
    "flex min-w-0 items-center gap-3 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
  const body = (
    <>
      <TimeBlock time={c.departure} cancelled={c.cancelled} showLive={showLive} />
      <TimeBlock time={c.arrival} cancelled={c.cancelled} showLive={showLive} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm leading-tight">
        <span className="text-muted-foreground">{durationText(c.durationMin)}</span>
        {legs && <span className="text-xs text-muted-foreground">{legs.length - 1} átszállás</span>}
        {(showLive || c.cancelled) && (
          <DelayText
            time={{ ...c.departure, delayMin: c.currentDelayMin ?? c.departure.delayMin }}
            cancelled={c.cancelled}
            className="text-xs"
          />
        )}
        {c.fromPlatform && <span className="text-xs text-muted-foreground">{platformText(c.fromPlatform)}</span>}
      </div>
    </>
  )
  return (
    <li className="flex flex-col">
      <div className="relative flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1">
          {(legs ?? [c]).map((l, i) => (
            <TrainBadge key={i} label={l.label} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {legs ? (
            <button type="button" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={stretched}>
              {body}
            </button>
          ) : (
            <a href={href.train(c.tripId, c.serviceDate, from, to)} aria-label={label} className={stretched}>
              {body}
            </a>
          )}
          <DelayReason reason={c.reason} />
        </div>
        {legs ? (
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground", open && "rotate-180")} aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </div>
      {legs && open && <JourneyTimeline c={c} legs={legs} showLive={showLive} />}
    </li>
  )
}

/** A station on the timeline: arrival / departure times, name, platform. */
interface TimelineStop {
  name: string
  arrival: TimeInfo | null
  departure: TimeInfo | null
  platform: string | null
  /** Change station: minutes between the trains. */
  changeMin: number | null
}

/**
 * The trip with changes, like the MÁV app: every station where you get on, change or get off
 * (times, platform), and between them the train you ride (badge, ride time, link to the train
 * with your stations marked). The first departure carries the live estimate.
 */
function JourneyTimeline({ c, legs, showLive }: { c: Connection; legs: Leg[]; showLive: boolean }) {
  const minutes = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60000)
  const stops: TimelineStop[] = [
    { name: legs[0]!.from.name, arrival: null, departure: c.departure, platform: legs[0]!.fromPlatform, changeMin: null },
    ...legs.slice(1).map((l, i) => ({
      name: l.from.name,
      arrival: legs[i]!.arrival,
      departure: l.departure,
      platform: l.fromPlatform,
      changeMin: minutes(legs[i]!.arrival.planned, l.departure.planned),
    })),
    { name: legs.at(-1)!.to.name, arrival: legs.at(-1)!.arrival, departure: null, platform: legs.at(-1)!.toPlatform, changeMin: null },
  ]
  return (
    <ol className="flex flex-col px-4 pt-4 pb-8 text-sm">
      {stops.map((s, i) => {
        const leg = legs[i]
        return (
          <li key={i} className="flex flex-col">
            <div className="flex items-stretch gap-3">
              <div className="flex w-14 shrink-0 flex-col items-end leading-tight tabular-nums">
                {s.arrival && <span className={cn(s.departure && "text-muted-foreground")}>{timeParts(s.arrival.planned).time}</span>}
                {s.departure && <span className="font-semibold">{timeParts(s.departure.planned).time}</span>}
                {s.departure && i === 0 && <ExpectedTime time={s.departure} cancelled={c.cancelled} showLive={showLive} />}
              </div>
              {/* Rail: a line into the dot (not at the first stop) and out of it (not at the last). */}
              <span className="flex w-2.5 shrink-0 flex-col items-center" aria-hidden>
                <span className={cn("h-1 w-0.5", i > 0 && "bg-border")} />
                <span className="size-2.5 shrink-0 rounded-full border-2 border-foreground" />
                <span className={cn("w-0.5 flex-1", i < stops.length - 1 && "bg-border")} />
              </span>
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[s.platform && platformText(s.platform), s.changeMin !== null && `átszállás, ${s.changeMin} perc`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
            {leg && (
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {durationText(minutes(leg.departure.planned, leg.arrival.planned))}
                </span>
                {/* The ride: a line down to the next station, the train's badge and its link. */}
                <span className="flex w-2.5 shrink-0 justify-center self-stretch" aria-hidden>
                  <span className="w-0.5 bg-border" />
                </span>
                <div className="flex min-w-0 items-center gap-2 py-3 pl-1">
                  <TrainBadge label={leg.label} />
                  <a
                    href={href.train(leg.tripId, leg.serviceDate, leg.from.id, leg.to.id)}
                    className="min-w-0 truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {leg.headsign ? <><RouteArrow /> {leg.headsign}</> : "Vonat adatai"}
                  </a>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
