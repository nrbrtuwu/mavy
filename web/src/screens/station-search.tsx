import { useState } from "react"

import { PageHeader } from "@/components/layout"
import { SearchInput, StationResults, useStationSearch } from "@/components/station-picker"
import { href } from "@/lib/router"

export function StationSearchScreen() {
  const [query, setQuery] = useState("")
  const { stations, error } = useStationSearch(query)
  return (
    <>
      <PageHeader title="Állomás keresése" description="Írd be az állomás nevét, ékezetek nélkül is megy." />
      <label htmlFor="q" className="sr-only">
        Állomás neve
      </label>
      <SearchInput id="q" value={query} onChange={setQuery} placeholder="pl. Keleti, Győr" autoFocus />
      <StationResults stations={stations} error={error} hrefFor={(s) => href.board(s.id)} />
    </>
  )
}
