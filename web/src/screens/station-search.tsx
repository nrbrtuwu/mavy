import { useKeptState } from "@/hooks/use-kept-state"

import { Screen, ScreenSection } from "@/components/layout"
import { SearchInput, StationResults, useStationSearch } from "@/components/station-picker"
import { recordStationPick } from "@/lib/frequent-stations"
import { href } from "@/lib/router"

export function StationSearchScreen() {
  const [query, setQuery] = useKeptState("station-search:query", "")
  const search = useStationSearch(query)
  return (
    <Screen title="Állomás keresése" description="Írd be az állomás nevét, ékezetek nélkül is megy">
      <ScreenSection>
        <label htmlFor="q" className="sr-only">
          Állomás neve
        </label>
        <SearchInput id="q" value={query} onChange={setQuery} placeholder="pl. Keleti, Győr" autoFocus />
        <StationResults search={search} onPick={recordStationPick} hrefFor={(s) => href.board(s.id)} />
      </ScreenSection>
    </Screen>
  )
}
