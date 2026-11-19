// Display helpers (Hungarian UI text). Pure functions, unit-tested in test/format.test.ts.
// API times are ISO strings with the Budapest offset, so their local date and
// clock time can be read directly from the string.

import type { LiveInfo, TimeInfo } from "./types"

const TZ = "Europe/Budapest"
const DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }) // YYYY-MM-DD
const CLOCK = new Intl.DateTimeFormat("hu-HU", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
const MONTHS = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."]

/** Today's Budapest date, 'YYYY-MM-DD'. */
export function today(now = Date.now()): string {
  return DAY.format(now)
}

/** 'YYYY-MM-DD' shifted by n days. */
export function shiftDate(ymd: string, n: number): string {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)) + n))
  return d.toISOString().slice(0, 10)
}

function dayWord(ymd: string, now: number): string {
  const t = today(now)
  if (ymd === t) return ""
  if (ymd === shiftDate(t, 1)) return "holnap"
  if (ymd === shiftDate(t, -1)) return "tegnap"
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}.`
}

/** '2026-11-13T00:52:00+01:00' -> { time: '00:52', day: 'holnap' }. day is '' for today. */
export function timeParts(iso: string | null | undefined, now = Date.now()): { time: string; day: string } {
  if (!iso) return { time: "", day: "" }
  return { time: iso.slice(11, 16), day: dayWord(iso.slice(0, 10), now) }
}

/** Budapest clock time of an instant (ms or any ISO string). */
export function clock(value: number | string): string {
  return CLOCK.format(typeof value === "number" ? value : Date.parse(value))
}

/** When offline data was saved: '08:57', 'tegnap 22:10' or 'nov. 3. 18:00'. */
export function savedLabel(ms: number, now = Date.now()): string {
  const day = dayWord(today(ms), now)
  return day ? `${day} ${clock(ms)}` : clock(ms)
}

/** 'YYYYMMDD' -> 'ma', 'tegnap', 'holnap' or '2026. nov. 20.' */
export function serviceDateLabel(yyyymmdd: string, now = Date.now()): string {
  const ymd = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  const word = dayWord(ymd, now)
  if (word === "") return "ma"
  if (word === "holnap" || word === "tegnap") return word
  return `${ymd.slice(0, 4)}. ${word}`
}

export type DelayKind = "cancelled" | "late" | "onTime" | "unknown"

/**
 * Delay as text: 'törölve', '+12 perc', 'időben', 'nincs adat'.
 * late and cancelled are shown in red; strong = 5+ minutes or cancelled.
 */
export function delayStatus(
  time: Pick<TimeInfo, "delayMin"> | null | undefined,
  cancelled: boolean
): { kind: DelayKind; text: string; strong: boolean } {
  if (cancelled) return { kind: "cancelled", text: "törölve", strong: true }
  if (!time || time.delayMin === null || time.delayMin === undefined) {
    return { kind: "unknown", text: "nincs adat", strong: false }
  }
  if (time.delayMin <= 0) return { kind: "onTime", text: "időben", strong: false }
  return { kind: "late", text: `+${time.delayMin} perc`, strong: time.delayMin >= 5 }
}

/** 170 -> '2 ó 50 p' */
export function durationText(min: number): string {
  if (min < 60) return `${min} p`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} ó` : `${h} ó ${m} p`
}

/** '4' -> '4. vágány', '4a' -> '4a vágány', null -> '' */
export function platformText(p: string | null | undefined): string {
  if (!p) return ""
  return /^\d+$/.test(p) ? `${p}. vágány` : `${p} vágány`
}

export type TrainCategory =
  | "ic"
  | "szemely"
  | "rjx"
  | "ir"
  | "z"
  | "g"
  | "potlo"
  | "icb"
  | "b"
  | "1a"
  | "ec"
  | "en"
  | null

/**
 * Train kind from its label, for the badge colour. Colours chosen by the owner, or the
 * official route_color from MÁV's GTFS feed where it has one (checked 2026-11), or MÁV's
 * dark blue from its own app for EC/EN:
 *   "IC 562 TOKAJ"        -> ic       yellow (owner)
 *   "S80", "Sz 359"       -> szemely  blue (owner; feed S-lines #00A0E3)
 *   "rjx 62"              -> rjx      red (owner)
 *   "IR85 MÁTRA"          -> ir       green (owner; feed #29803C)
 *   "Z60"                 -> z        amber (feed #FECC00, zónázó)
 *   "G40"                 -> g        lime (feed #B0CB1F)
 *   "Pótló 5267"          -> potlo    yellow (feed #FFFF00, replacement bus)
 *   "ICB 201 AGRAM", "B"  -> icb / b  yellow (feed #FFFF00)
 *   "1A"                  -> 1a       orange (feed #F5AD0E)
 *   "EC 142", "EN 476"    -> ec / en  dark blue (MÁV app #274F96)
 *   anything else ("VESz 5420", "BESZ 6031", "39830") -> null (neutral, no colour known)
 */
export function trainCategory(label: string | null | undefined): TrainCategory {
  if (!label) return null
  const first = label.trim().split(/\s+/)[0] ?? ""
  if (first === "IC") return "ic"
  if (first === "Sz" || /^S\d+$/.test(first)) return "szemely"
  if (first.toLowerCase() === "rjx") return "rjx"
  if (/^IR\d*$/i.test(first)) return "ir"
  if (/^Z\d+$/.test(first)) return "z"
  if (/^G\d+$/.test(first)) return "g"
  if (first === "Pótló") return "potlo"
  if (first === "ICB") return "icb"
  if (first === "B") return "b"
  if (first === "1A") return "1a"
  if (first === "EC") return "ec"
  if (first === "EN") return "en"
  return null
}

/**
 * Short badge text: the kind or line code in capitals, the full name stays for the popup.
 *   "IC 562 TOKAJ" -> "IC", "rjx 62" -> "RJX", "S80" -> "S80", "IR85 MÁTRA" -> "IR85",
 *   "Sz 359" -> "SZ", "Pótló 5267" -> "PÓTLÓ", "39830" -> "39830"
 */
export function shortTrainLabel(label: string): string {
  const first = label.trim().split(/\s+/)[0] ?? ""
  return first.toLocaleUpperCase("hu-HU")
}

/** Line describing the live data state of a screen. */
export function liveText(live: LiveInfo): string {
  if (live.state === "live") return "Élő késésadat"
  if (live.state === "stale") {
    // The server could not reach the live source and serves its last copy.
    return `Utolsó élő adat ${live.fetchedAt ? clock(live.fetchedAt) : "?"}, frissíteni nem sikerült`
  }
  return "Nincs élő késésadat, a menetrend szerinti idők láthatók"
}
