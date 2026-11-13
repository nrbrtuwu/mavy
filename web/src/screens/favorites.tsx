import { ChevronRight, MapPin, Route as RouteIcon, Search, Star, Trash2 } from "lucide-react"

import { PageHeader } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { favId, favLabel, toggleFavorite, useFavorites, type Favorite } from "@/lib/favorites"
import { href } from "@/lib/router"

const favHref = (f: Favorite) => (f.type === "station" ? href.board(f.id) : href.route(f.from.id, f.to.id))

export function FavoritesScreen() {
  const favorites = useFavorites()
  return (
    <>
      <PageHeader title="Kedvencek" description="A kedvencek csak ezen az eszközön tárolódnak." />
      {favorites.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="size-4" aria-hidden />
              Még nincs kedvenced
            </CardTitle>
            <CardDescription>
              Nyiss meg egy állomást vagy útvonalat, és nyomd meg a „Kedvencekhez” gombot.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={href.stations()}>
                <Search aria-hidden />
                Állomás keresése
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={href.routeForm()}>
                <RouteIcon aria-hidden />
                Útvonal
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <ul className="divide-y">
            {favorites.map((f) => {
              const Icon = f.type === "station" ? MapPin : RouteIcon
              return (
                <li key={favId(f)} className="flex items-center gap-1 pr-2">
                  <a href={favHref(f)} className="flex min-h-12 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1 font-medium">{favLabel(f)}</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${favLabel(f)} törlése a kedvencek közül`}
                    onClick={() => toggleFavorite(f)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </>
  )
}
