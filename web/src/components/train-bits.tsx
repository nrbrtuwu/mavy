// Small building blocks shared by the board, route and train screens.

import { AlertTriangle, CircleAlert, CloudOff, Radio, WifiOff } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { clock, delayStatus, liveText, savedLabel, shortTrainLabel, timeParts, trainCategory, type TrainCategory } from "@/lib/format"
import { useMnrFont } from "@/hooks/use-mnr-font"
import { mnrGlyph } from "@/lib/mnr"
import type { LiveInfo, TimeInfo } from "@/lib/types"

/**
 * Delay as red text ('+12 perc', 'törölve'), neutral for 'időben'. Nothing without live data:
 * the screen's live status line already says so, a label on every row would only add noise.
 */
export function DelayText({
  time,
  cancelled,
  className,
}: {
  time: TimeInfo | null | undefined
  cancelled: boolean
  className?: string
}) {
  const s = delayStatus(time, cancelled)
  if (s.kind === "unknown") return null
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        s.kind === "late" || s.kind === "cancelled" ? "text-destructive" : "text-muted-foreground",
        s.strong && "font-semibold",
        className,
      )}
    >
      {s.text}
    </span>
  )
}

const YELLOW =
  "border-yellow-500/40 bg-yellow-400/15 text-yellow-700 dark:border-yellow-400/40 dark:bg-yellow-400/15 dark:text-yellow-300"
const DARK_BLUE =
  "border-indigo-600/40 bg-indigo-600/15 text-indigo-800 dark:border-indigo-400/40 dark:bg-indigo-400/20 dark:text-indigo-200"

/**
 * Badge colours per train kind (text + tinted bubble), readable in light and dark mode.
 * Where they come from: see trainCategory() in lib/format.ts.
 */
const CATEGORY_CLASSES: Record<NonNullable<TrainCategory>, string> = {
  ic: "border-yellow-500/40 bg-yellow-400/15 text-yellow-700 dark:border-yellow-400/40 dark:bg-yellow-400/15 dark:text-yellow-300",
  szemely: "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:border-blue-400/40 dark:bg-blue-400/15 dark:text-blue-300",
  rjx: "border-red-500/40 bg-red-500/15 text-red-700 dark:border-red-400/40 dark:bg-red-400/15 dark:text-red-300",
  ir: "border-green-600/40 bg-green-500/15 text-green-700 dark:border-green-400/40 dark:bg-green-400/15 dark:text-green-300",
  z: "border-amber-500/40 bg-amber-400/15 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300",
  g: "border-lime-600/40 bg-lime-500/15 text-lime-700 dark:border-lime-400/40 dark:bg-lime-400/15 dark:text-lime-300",
  potlo: YELLOW,
  icb: YELLOW,
  b: YELLOW,
  "1a": "border-orange-500/40 bg-orange-400/15 text-orange-700 dark:border-orange-400/40 dark:bg-orange-400/15 dark:text-orange-300",
  ec: DARK_BLUE,
  en: DARK_BLUE,
} as const

/**
 * Dark-mode colours of the MNR2007 glyph badges. The text badges' pale -300/-200 shades look
 * washed out on a solid glyph, so glyphs use the deeper -500 shades in dark mode.
 */
const GLYPH_DARK: Record<NonNullable<TrainCategory>, string> = {
  ic: "dark:text-yellow-500",
  szemely: "dark:text-blue-500",
  rjx: "dark:text-red-500",
  ir: "dark:text-green-500",
  z: "dark:text-amber-500",
  g: "dark:text-lime-500",
  potlo: "dark:text-yellow-500",
  icb: "dark:text-yellow-500",
  b: "dark:text-yellow-500",
  "1a": "dark:text-orange-500",
  ec: "dark:text-indigo-500",
  en: "dark:text-indigo-500",
}

/** Colour of a kind's MNR2007 glyph badge (a single colour): light-mode text colour + GLYPH_DARK. */
function glyphColour(category: NonNullable<TrainCategory>): string {
  const light = CATEGORY_CLASSES[category].split(" ").filter((c) => c.startsWith("text-"))
  return [...light, GLYPH_DARK[category]].join(" ")
}

/** Shown in the badge popup under the full name; only where the meaning is known. */
const CATEGORY_NAMES: Partial<Record<NonNullable<TrainCategory>, string>> = {
  ic: "InterCity",
  szemely: "Személyvonat",
  rjx: "railjet xpress",
  ir: "InterRégió",
  z: "Zónázó",
  potlo: "Vonatpótló busz",
  ec: "EuroCity",
  en: "EuroNight",
}

/**
 * Train badge: only the kind or line code in capitals (IC, RJX, S80 …). Tapping it opens
 * a small popup with the full name ("IC 562 TOKAJ"). Colours: IC yellow, személyvonat
 * (S-lines, Sz) blue, others neutral.
 *
 * It is a button of its own, so in a list row it must sit outside the row's link (rows use
 * a stretched link with this badge above it, see `relative z-10`).
 */
export function TrainBadge({ label, className }: { label: string | null; className?: string }) {
  const fontOk = useMnrFont()
  if (!label) return null
  const category = trainCategory(label)
  const short = shortTrainLabel(label)
  // Without the font file (not in git, `bun run fetch-font`) every badge is a text badge.
  const glyph = fontOk ? mnrGlyph(short) : null
  const badge = glyph ? (
    // MÁV's own badge from the MNR2007 font, in the kind's colour (text colour only).
    <span
      role="img"
      aria-label={short}
      className={cn("inline-flex font-[MNR] text-[22px] leading-none", category ? glyphColour(category) : "text-foreground", className)}
    >
      {glyph}
    </span>
  ) : (
    <Badge variant="outline" className={cn(category && CATEGORY_CLASSES[category], className)}>
      {short}
    </Badge>
  )
  const kindName = category ? CATEGORY_NAMES[category] : undefined
  // Nothing more to show (e.g. "G40": full name = badge, kind unnamed): no popup.
  if (short === label.trim() && !kindName) return badge
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Vonat: ${label}`}
          // Larger tap area than the small badge itself; above a row's stretched link.
          className="relative z-10 -m-2 inline-flex cursor-pointer rounded-md p-2 focus-visible:outline-2"
        >
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-72 px-3 py-2 text-sm" side="top" align="start">
        <p className="font-medium">{label}</p>
        {kindName && <p className="text-xs text-muted-foreground">{kindName}</p>}
      </PopoverContent>
    </Popover>
  )
}

/** Why the train is late or cancelled, when the live source says so. */
export function DelayReason({ reason, className }: { reason: string | null | undefined; className?: string }) {
  if (!reason) return null
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-destructive", className)}>
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Ok: </span>
        {reason}
      </span>
    </p>
  )
}

/**
 * Planned time on top (with 'holnap' / date when not today), and under it the small
 * expected time from live data: red when late, green when on time, 'törölve' when
 * cancelled. Nothing under it without live data.
 */
export function TimeBlock({
  time,
  cancelled,
  showLive,
  className,
}: {
  time: TimeInfo
  cancelled: boolean
  showLive: boolean
  className?: string
}) {
  const planned = timeParts(time.planned)
  return (
    <div className={cn("flex w-12 shrink-0 flex-col leading-tight tabular-nums", className)}>
      <span className={cn("text-base font-semibold", cancelled && "text-muted-foreground line-through")}>
        {planned.time}
      </span>
      {planned.day && <span className="text-xs text-muted-foreground">{planned.day}</span>}
      <ExpectedTime time={time} cancelled={cancelled} showLive={showLive} />
    </div>
  )
}

/** The small time under a planned time: expected time (red late / green on time) or 'törölve'. */
export function ExpectedTime({ time, cancelled, showLive }: { time: TimeInfo; cancelled: boolean; showLive: boolean }) {
  if (cancelled) return <span className="text-xs font-semibold text-destructive">törölve</span>
  if (!showLive || time.delayMin === null) return null
  const late = time.delayMin > 0
  const shown = timeParts(late && time.expected ? time.expected : time.planned).time
  return (
    <span
      className={cn(
        "text-xs font-medium",
        late ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
        late && time.delayMin >= 5 && "font-bold",
      )}
      title={late ? `várható ${shown}, +${time.delayMin} perc` : "időben"}
    >
      {shown}
    </span>
  )
}

/**
 * Where the shown data comes from: live delays, an old copy, or planned times only.
 * Also reports offline copies and failed refreshes.
 */
export function LiveStatus({
  live,
  dataTime,
  savedAt,
  refreshError,
}: {
  live: LiveInfo
  dataTime: number | null
  savedAt: number | null
  refreshError: { at: number; message: string } | null
}) {
  return (
    <div className="flex flex-col gap-2">
      {savedAt !== null && (
        <Alert>
          <WifiOff aria-hidden />
          <AlertTitle>Nincs kapcsolat a szerverrel</AlertTitle>
          <AlertDescription>Mentett adat látható ({savedLabel(savedAt)}).</AlertDescription>
        </Alert>
      )}
      {refreshError && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>A frissítés nem sikerült ({clock(refreshError.at)})</AlertTitle>
          <AlertDescription>{refreshError.message}</AlertDescription>
        </Alert>
      )}
      {live.state === "none" && savedAt === null && (
        <Alert>
          <CloudOff aria-hidden />
          <AlertTitle>Nincs élő késésadat</AlertTitle>
          <AlertDescription>
            A menetrend szerinti idők láthatók. Késés és késési ok csak élő adatforrással jelenik meg.
          </AlertDescription>
        </Alert>
      )}
      {(live.state !== "none" || savedAt !== null) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Radio className={cn("size-3.5", live.state === "live" && savedAt === null && "text-foreground")} aria-hidden />
          {savedAt !== null ? `Utolsó élő adat ${clock(savedAt)}, frissíteni nem sikerült` : liveText(live)}
          {/* "Frissítve": when this page last got an answer. With stale delays that is not the delays' time. */}
          {dataTime !== null && savedAt === null && (live.state === "stale" ? ` · Lekérve ${clock(dataTime)}` : ` · Frissítve ${clock(dataTime)}`)}
        </p>
      )}
    </div>
  )
}
