import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react"
import { ArrowLeftRight, Search, X } from "lucide-react"

import { Screen, ScreenSection } from "@/components/layout"
import { StationResults, useReachable, useStationSearch } from "@/components/station-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useKeptState } from "@/hooks/use-kept-state"
import { useRecordStationPick } from "@/lib/frequent-stations"
import { readLastRoute, writeLastRoute } from "@/lib/last-route"
import { href } from "@/lib/router"
import type { Station } from "@/lib/types"

type Side = "from" | "to"

/**
 * One station slot (Honnan / Hová). Narrow, because the two sit side by side: either a
 * search input, or the picked station (cut off with … if long) with a clear button.
 * Search results are shown by the form, full width below both slots.
 */
function StationSlot({
  id,
  label,
  value,
  query,
  inputRef,
  onQuery,
  onFocus,
  onClear,
}: {
  id: string
  label: string
  value: Station | null
  query: string
  inputRef: RefObject<HTMLInputElement | null>
  onQuery: (q: string) => void
  onFocus: () => void
  onClear: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {value ? (
        <div className="flex h-11 min-w-0 items-center gap-1 rounded-md border pr-1 pl-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={value.name}>
            {value.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label={`${label}: ${value.name} törlése`}
            onClick={onClear}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <Input
          ref={inputRef}
          id={id}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onFocus={onFocus}
          placeholder="Állomás"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-11 text-base md:text-base"
        />
      )}
    </div>
  )
}

export function RouteFormScreen() {
  // Stations start from the last ones used on this device (also after a reload).
  const [from, setFrom] = useKeptState<Station | null>("route-form:from", () => readLastRoute().from)
  const [to, setTo] = useKeptState<Station | null>("route-form:to", () => readLastRoute().to)
  const [fromQuery, setFromQuery] = useKeptState("route-form:query:from", "")
  const [toQuery, setToQuery] = useKeptState("route-form:query:to", "")
  /** Which slot the full-width result list belongs to: the one typed in last. */
  const [active, setActive] = useKeptState<Side>("route-form:active", "from")
  const [time, setTime] = useKeptState("route-form:time", "")
  const [message, setMessage] = useState<string | null>(null)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    writeLastRoute({ from, to })
  }, [from, to])

  // The result list belongs to the active slot, and only while that slot has no station.
  const activeEmpty = active === "from" ? !from : !to
  const activeQuery = active === "from" ? fromQuery : toQuery
  // Hová: only stations a direct train from Honnan reaches (all of them until that list loads).
  const reachable = useReachable(from?.id ?? null)
  const only = active === "to" ? reachable.set : null
  const unfiltered = active === "to" && !!from && reachable.failed
  const search = useStationSearch(activeQuery, only)
  const recordStationPick = useRecordStationPick()

  /** Focus a slot's input once it is rendered (it may just have replaced the picked chip). */
  const focusSlot = (side: Side) =>
    window.setTimeout(() => (side === "from" ? fromInput : toInput).current?.focus(), 0)

  const pick = (s: Station) => {
    recordStationPick(s)
    if (active === "from") {
      setFrom(s)
      setFromQuery("")
      if (!to) {
        setActive("to")
        focusSlot("to")
      }
    } else {
      setTo(s)
      setToQuery("")
      if (!from) {
        setActive("from")
        focusSlot("from")
      }
    }
  }

  const clear = (side: Side) => {
    if (side === "from") {
      setFrom(null)
      setFromQuery("")
    } else {
      setTo(null)
      setToQuery("")
    }
    setActive(side)
    focusSlot(side)
  }

  const swap = () => {
    setFrom(to)
    setTo(from)
    setFromQuery(toQuery)
    setToQuery(fromQuery)
    setActive(active === "from" ? "to" : "from")
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!from || !to) return setMessage("Válaszd ki az indulási és a célállomást a listából.")
    if (from.id === to.id) return setMessage("Az indulási és a célállomás ugyanaz.")
    window.location.hash = href.route(from.id, to.id, time || null)
  }

  return (
    <Screen title="Útvonal" description="Közvetlen vonatok két állomás között">
      <ScreenSection>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* Honnan [⇄] Hová */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <StationSlot
              id="from"
              label="Honnan"
              value={from}
              query={fromQuery}
              inputRef={fromInput}
              onQuery={(q) => {
                setFromQuery(q)
                setActive("from")
              }}
              onFocus={() => setActive("from")}
              onClear={() => clear("from")}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Csere"
              title="Állomások cseréje"
              onClick={swap}
            >
              <ArrowLeftRight aria-hidden />
            </Button>
            <StationSlot
              id="to"
              label="Hová"
              value={to}
              query={toQuery}
              inputRef={toInput}
              onQuery={(q) => {
                setToQuery(q)
                setActive("to")
              }}
              onFocus={() => setActive("to")}
              onClear={() => clear("to")}
            />
          </div>
          {/* Results for the slot being typed in, full width below both. */}
          {activeEmpty && (
            <StationResults
              search={search}
              onPick={pick}
              note={
                only && from
                  ? `Közvetlen vonattal elérhető innen: ${from.name}`
                  : unfiltered
                    ? "Nem sikerült betölteni, hova megy közvetlen vonat: minden állomás látszik"
                    : null
              }
              empty={only && from ? `Nincs ilyen állomás közvetlen vonattal innen: ${from.name}` : undefined}
            />
          )}
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
