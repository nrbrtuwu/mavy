import { useEffect, useMemo, useState } from "react"
import { ChevronRight, MapPin, Route as RouteIcon, Search, Trash2 } from "lucide-react"

import { Screen, ScreenList, ScreenSection } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { RouteArrow, RouteName } from "@/components/route-arrow"
import { DelayText } from "@/components/train-bits"
import { useLiveData } from "@/hooks/use-live-data"
import { favId, favLabel, toggleFavorite, useFavorites, type Favorite } from "@/lib/favorites"
import { timeParts } from "@/lib/format"
import { nextFromBoard, nextFromRoute, type NextTrain } from "@/lib/next-train"
import { MAX, favoriteRequest } from "@/lib/prefetch-favorites"
import { href } from "@/lib/router"
import type { BoardResponse, RouteResponse } from "@/lib/types"

const favHref = (f: Favorite) => (f.type === "station" ? href.board(f.id) : href.route(f.from.id, f.to.id))

export function FavoritesScreen() {
  const favorites = useFavorites()
  return (
    <Screen title="Kedvencek">
      {favorites.length === 0 ? (
        <ScreenSection>
          <p className="text-sm">
            Még nincs kedvenced. Nyiss meg egy állomást vagy útvonalat, és nyomd meg a „Kedvencekhez” gombot.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={href.routeForm()}>
                <RouteIcon aria-hidden />
                Útvonal
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={href.stations()}>
                <Search aria-hidden />
                Állomás keresése
              </a>
            </Button>
          </div>
        </ScreenSection>
      ) : (
        <ScreenList>
          {favorites.map((f, i) => {
            const Icon = f.type === "station" ? MapPin : RouteIcon
            return (
              <li key={favId(f)} className="flex items-center gap-1 pr-2">
                <a href={favHref(f)} className="flex min-h-12 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">
                      {f.type === "station" ? f.name : <RouteName from={f.from.name} to={f.to.name} />}
                    </span>
                    {/* The first MAX favourites (the ones preloaded at start-up) show their next train. */}
                    {i < MAX && <FavoriteNext favorite={f} />}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`${favLabel(f)} törlése a kedvencek közül`}
                  onClick={() => toggleFavorite(f)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            )
          })}
        </ScreenList>
      )}
    </Screen>
  )
}

/** Favourites refresh more often than other screens: they show only the next train. */
const FAVORITE_REFRESH_MS = 30_000
/** How often the next train is picked again from the data (a departed one drops off). */
const TICK_MS = 15_000

/** Re-render every `ms` while mounted. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** "16:11 → Győr +6 perc" (station) or "16:11 → 17:19 +6 perc" (route): the next train. */
function FavoriteNext({ favorite }: { favorite: Favorite }) {
  const req = useMemo(() => favoriteRequest(favorite), [favorite])
  const { data, error, savedAt, refreshError } = useLiveData<BoardResponse | RouteResponse>(
    req.key,
    req.load as () => Promise<BoardResponse | RouteResponse>,
    FAVORITE_REFRESH_MS,
  )
  const now = useTick(TICK_MS)
  if (!data) {
    return (
      <span className="text-xs text-muted-foreground">{error ? "Nem sikerült betölteni" : "Betöltés…"}</span>
    )
  }
  // An offline copy or a failed refresh: the data may be old, its trains may have left.
  const stale = savedAt !== null || refreshError !== null
  const next: NextTrain | null =
    favorite.type === "station" ? nextFromBoard(data as BoardResponse, now) : nextFromRoute(data as RouteResponse, now)
  if (!next) {
    return (
      <span className="text-xs text-muted-foreground">
        {stale ? "Nincs friss adat" : "Nincs vonat 24 órán belül"}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
      <span className={next.cancelled ? "line-through" : "text-foreground"}>{timeParts(next.departure.planned).time}</span>
      <RouteArrow />
      <span className="truncate">{next.arrival ? timeParts(next.arrival.planned).time : next.headsign}</span>
      {next.live && <DelayText time={{ ...next.departure, delayMin: next.delayMin }} cancelled={next.cancelled} />}
      {stale && <span>· nem friss</span>}
    </span>
  )
}
