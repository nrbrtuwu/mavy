import { useKeptState } from "@/hooks/use-kept-state"

import { Screen, ScreenSection } from "@/components/layout"
import { SearchInput, StationResults, useStationSearch } from "@/components/station-picker"
import { useRecordStationPick } from "@/lib/frequent-stations"
import { href } from "@/lib/router"

export function StationSearchScreen() {
  const [query, setQuery] = useKeptState("station-search:query", "")
  const search = useStationSearch(query)
  const recordStationPick = useRecordStationPick()
  return (
    <Screen title="Állomás keresése">
      <ScreenSection>
        <SearchInput id="q" label="Állomás neve" value={query} onChange={setQuery} placeholder="pl. Keleti, Győr" autoFocus />
        <StationResults search={search} onPick={recordStationPick} hrefFor={(s) => href.board(s.id)} />
      </ScreenSection>
    </Screen>
  )
}
