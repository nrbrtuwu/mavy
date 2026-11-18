import { ChevronRight, MapPin, Route as RouteIcon, Search, Trash2 } from "lucide-react"

import { Screen, ScreenList, ScreenSection } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { RouteName } from "@/components/route-arrow"
import { favId, favLabel, toggleFavorite, useFavorites, type Favorite } from "@/lib/favorites"
import { href } from "@/lib/router"

const favHref = (f: Favorite) => (f.type === "station" ? href.board(f.id) : href.route(f.from.id, f.to.id))

export function FavoritesScreen() {
  const favorites = useFavorites()
  return (
    <Screen title="Kedvencek" description="Csak ezen az eszközön tárolódnak">
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
          {favorites.map((f) => {
            const Icon = f.type === "station" ? MapPin : RouteIcon
            return (
              <li key={favId(f)} className="flex items-center gap-1 pr-2">
                <a href={favHref(f)} className="flex min-h-12 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 font-medium">
                    {f.type === "station" ? f.name : <RouteName from={f.from.name} to={f.to.name} />}
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
