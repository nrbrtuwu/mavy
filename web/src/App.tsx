import { useEffect, type ReactNode } from "react"

import { AppShell, Screen, type Section } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { href, parentHref, parseHash, resolveStart, useHash } from "@/lib/router"
import { useSettings } from "@/lib/settings"
import { BoardScreen } from "@/screens/board"
import { FavoritesScreen } from "@/screens/favorites"
import { RouteFormScreen } from "@/screens/route-form"
import { RouteResultsScreen } from "@/screens/route-results"
import { SettingsScreen } from "@/screens/settings"
import { StationSearchScreen } from "@/screens/station-search"
import { TrainScreen } from "@/screens/train"

export function App() {
  const hash = useHash()
  const { startPage } = useSettings()
  const route = resolveStart(parseHash(hash), startPage)

  useEffect(() => {
    // Content scrolls inside the screen's box (see Screen), not the page.
    document.querySelector("[data-screen-body]")?.scrollTo(0, 0)
  }, [hash])

  let section: Section = null
  let screen: ReactNode
  switch (route.name) {
    case "favorites":
      section = "favorites"
      screen = <FavoritesScreen />
      break
    case "settings":
      section = "settings"
      screen = <SettingsScreen />
      break
    case "stations":
      section = "station"
      screen = <StationSearchScreen />
      break
    case "board":
      section = "station"
      screen = <BoardScreen key={route.id} stationId={route.id} />
      break
    case "routeForm":
      section = "route"
      screen = <RouteFormScreen />
      break
    case "route":
      section = "route"
      screen = <RouteResultsScreen key={hash} from={route.from} to={route.to} time={route.time} />
      break
    case "train":
      screen = <TrainScreen key={hash} tripId={route.tripId} date={route.date} on={route.on} off={route.off} />
      break
    default:
      screen = (
        <Screen
          title="Nincs ilyen oldal"
          actions={
            <Button asChild variant="outline">
              <a href={href.start()}>Vissza a kezdőlapra</a>
            </Button>
          }
        />
      )
  }

  return (
    <AppShell section={section} backHref={parentHref(route)}>
      {screen}
    </AppShell>
  )
}
