import { useState, type FormEvent } from "react"
import { ArrowUpDown, Search, X } from "lucide-react"

import { Screen, ScreenSection } from "@/components/layout"
import { SearchInput, StationResults, useStationSearch } from "@/components/station-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { href } from "@/lib/router"
import type { Station } from "@/lib/types"

/** Station field: search until a station is picked, then show the pick with a clear button. */
function StationField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: Station | null
  onChange: (s: Station | null) => void
}) {
  const [query, setQuery] = useState("")
  const { stations, error } = useStationSearch(value ? "" : query)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {value ? (
        <div className="flex h-11 items-center justify-between rounded-md border px-3">
          <span className="font-medium">{value.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${label}: ${value.name} törlése`}
            onClick={() => {
              onChange(null)
              setQuery("")
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <>
          <SearchInput id={id} value={query} onChange={setQuery} />
          <StationResults stations={stations} error={error} onPick={(s) => onChange(s)} />
        </>
      )}
    </div>
  )
}

export function RouteFormScreen() {
  const [from, setFrom] = useState<Station | null>(null)
  const [to, setTo] = useState<Station | null>(null)
  const [time, setTime] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!from || !to) return setMessage("Válaszd ki az indulási és a célállomást a listából.")
    if (from.id === to.id) return setMessage("Az indulási és a célállomás ugyanaz.")
    window.location.hash = href.route(from.id, to.id, time || null)
  }

  return (
    <Screen title="Útvonal" description="Közvetlen vonatok két állomás között.">
      <ScreenSection>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <StationField id="from" label="Honnan" value={from} onChange={setFrom} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                setFrom(to)
                setTo(from)
              }}
            >
              <ArrowUpDown aria-hidden />
              Csere
            </Button>
            <StationField id="to" label="Hová" value={to} onChange={setTo} />
            <div className="flex flex-col gap-2">
              <label htmlFor="ido" className="text-sm font-medium">
                Indulás <span className="font-normal text-muted-foreground">(üresen hagyva: most)</span>
              </label>
              <Input
                id="ido"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-11 w-36 text-base md:text-base"
              />
            </div>
            {message && (
              <Alert variant="destructive">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" className="h-11">
              <Search aria-hidden />
              Keresés
            </Button>
          </form>
      </ScreenSection>
    </Screen>
  )
}
