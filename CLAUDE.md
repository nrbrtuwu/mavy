# MÁV Tracker

Private PWA for tracking Hungarian trains (MÁV, GYSEV). Shows planned timetables plus live delays.
Users: the owner and a few close friends. Not a public product.

## Goals

- Station departure board with live delays
- Route search: next trains from station A to station B, direct or with changes (journey planner, `src/gtfs/planner.ts`: connection scan over the timetable, min. 3 min change at the same station; the first train of a trip with changes gets live data, the rest planned times)
- Train detail: every stop with planned time, expected time, delay
- Saved favorites (routes and stations), stored on the device
- Station search: the device's 5 most picked stations shown when the field is empty (each with an X to remove it) and ranked first (`web/src/lib/frequent-stations.ts`)
- Settings page (last navbar item): start page (default route search), animated background on/off, frequent stations on/off (default on), full screen on/off (default off: the screen's box fills the space under the navbar, edge to edge, on phones and desktop). Stored on the device
- Installable PWA, works on phones, shows last cached data when offline

## Non-goals

- No ticket sales, no accounts for strangers, no public launch
- No maps in the first version
- No animations beyond what shadcn/ui components do by default, except the greyscale animated background (`web/src/components/background.tsx`: fogya-tech's two `@paper-design/shaders-react` MeshGradient layers in greys, inverted in light mode; capped at 1x density and 600k px per layer, paused when hidden, still with reduced motion)

## Stack

- Runtime: Bun 1.3+ (runs TypeScript directly, no compile step). Do not use Node or npm
- Backend: TypeScript, Fastify
- Database: SQLite via Bun's built-in `bun:sqlite` (GTFS timetable). better-sqlite3 does not load under Bun
- Frontend: React 19 + Tailwind 4 + shadcn/ui (radix-nova style, neutral base) in `web/`, built with Vite into `dist/public/`. Use shadcn components for every UI element (add new ones with `bunx shadcn@latest add <name>` inside `web/`)
- PWA: manifest.webmanifest + service worker (network first for API, cache first for static files)
- Hosting: one small VPS or the owner's PC. Access gated by Tailscale or Cloudflare Access, or a shared password as a fallback

## Data sources

1. Timetable (planned data): MÁV GTFS feed. MÁV publishes it on mavcsoport.hu after a free developer registration, updated nightly.
   - The owner downloads the zip and places it in `data/gtfs/`. Never commit the GTFS files.
   - `bun run import-gtfs` loads stops, routes, trips, stop_times, calendar, calendar_dates into SQLite.
   - Verify the current download location and terms before relying on it.
2. Live delays: vonatinfo.mav.hu, MÁV's public train map (`src/live/vonatinfo.ts`, on by default, `MAVY_LIVE=off` disables it). Unofficial and undocumented: it can change without notice. Only its per-train (`TRAIN`) and per-station (`STATION`) requests are used, never the whole-country `TRAINS` list. Details in `docs/live-api/FINDINGS.md`. MÁV's official GTFS-Realtime feed (nap.mavcsoport.hu) would replace it once access is granted.
   - mavplusz.hu is not usable: its API needs a JWT obtained via Google reCAPTCHA. Do not work around that.
   - All live code lives behind the `LiveSource` interface in `src/live/types.ts` (one client file in `src/live/`). The rest of the app talks only to that interface.
   - A source may give a delay reason (`reason`); the UI shows it. Never invent reasons.

## Rules for the live API (must follow)

- Only the server calls the live API. Browsers never call MÁV directly.
- Cache every live response for 30 to 60 seconds. One upstream request serves all users.
- Fetch only what a user is looking at right now (one station, one train). Never scrape the whole country.
  - Owner's exception: at app start the first 5 favourites are preloaded with live data, one request after another, once per start (`web/src/lib/prefetch-favorites.ts`).
- Send a normal browser User-Agent, no request bursts, back off on errors (exponential, max 5 min).
- If the live API fails, still show planned times with a clear "no live data" label.

## Design rules

- shadcn/ui neutral theme everywhere (cards, buttons, badges, inputs, tables, alerts). No custom colour palette.
- Hues are limited to:
  - Red (shadcn `destructive`): delays, cancellations and delay reasons only. Delays are also written as text: "+12 perc", "időben", "törölve". Bold from 5 min.
  - Times (`TimeBlock` / `ExpectedTime`): planned time on top, the small expected time under it, red when late, green (emerald) when on time, "törölve" when cancelled. Nothing under it without live data.
  - Train name badges (`TrainBadge`, `trainCategory()` in `web/src/lib/format.ts`): IC yellow, személyvonat (S-lines like S80, and "Sz") blue, RJX red, IR (IR85, IR87 …) green (owner's choices); Z amber, G lime, Pótló / ICB / B yellow, 1A orange (official route_color in MÁV's GTFS); EC / EN dark blue (MÁV app). VESz, BESZ and number-only trains have no known colour and stay neutral. Mapping and sources: `trainCategory()`. They show only the short code in capitals (`shortTrainLabel()`: IC, RJX, S80); tapping opens a popover with the full name. In list rows the badge sits above a stretched row link (never a button inside an `<a>`).
  - Everything else is neutral.
- Font: shadcn's Geist for all text. Train badges use MÁV's own badge font MNR2007 (`web/public/fonts/MNR2007.ttf`, gitignored: no licence to redistribute; `bun run fetch-font` downloads it from jegy.mav.hu, and without it `useMnrFont()` falls back to text badges): one glyph per train kind or line, mapped in `web/src/lib/mnr.ts`, coloured with the kind's text colour. Codes without a glyph (ICB, VESz, BESZ, Pótló …) keep the text badge.
- Corners: `--radius: 0.5rem` (8px, owner's choice) in `web/src/index.css`, text badges `rounded-md`. Switches and radio buttons stay round.
- Back: an arrow-left icon button ("Vissza" for screen readers) in the top right of the screen's box on detail screens (board, route results, train; `parentHref()` in `web/src/lib/router.ts`). It goes to the previous app page, or to the parent screen when there is none. In the iPhone home-screen app (no system swipe-back there) a left-edge swipe does the same (`web/src/hooks/use-edge-swipe-back.ts`); in browsers and on Android the browser/system Back is left alone.
- Light and dark mode follow the device (`prefers-color-scheme` sets shadcn's `.dark` class).
- Generous tap targets (min 44px). Lucide icons.
- App icon, theme colour and splash screen stay greyscale: simple monochrome icon (192px, 512px, maskable).

## Project layout

```
src/
  server.ts          Fastify app, routes, static files
  auth.ts            optional shared password (MAVY_PASSWORD)
  gtfs/import.ts     GTFS zip -> SQLite
  gtfs/queries.ts    departures, route search, trip stops, connection graph
  gtfs/planner.ts    journey planner (trips with changes)
  live/cache.ts      shared 45 s cache, request pacing, exponential backoff (no MÁV knowledge)
  live/types.ts      LiveSource interface, LiveTrain, LiveStop, delay + reason types
  live/vonatinfo.ts  live client: vonatinfo.mav.hu TRAIN/STATION HTML -> LiveTrain/LiveBoard
  merge.ts           planned + live -> what the UI shows
  time.ts            Europe/Budapest time helpers (service days, DST, ISO output)
test/                bun:test tests, fixtures/gtfs/ = tiny fake feed
scripts/dev.ts       runs server + Vite together
scripts/make-icons.ts  generates web/public/icons/ (SVG + greyscale PNGs)
scripts/fetch-font.ts  downloads MÁV's MNR2007 badge font (gitignored)
web/                 frontend (React + Tailwind + shadcn/ui, own package.json)
  src/App.tsx        hash router -> screens/
  src/screens/       route form/results, station search, board, train, favorites, settings
  src/components/    shared pieces; ui/ = shadcn components (generated, edit sparingly)
  src/lib/           api, format, router, settings (tested), favorites, types
  public/            manifest.webmanifest, sw.js, icons/ (copied into the build)
dist/public/         built frontend served by the server (gitignored)
data/gtfs/           GTFS zip (gitignored)
docs/live-api/       captured request/response samples
```

## API (own backend)

- `GET /api/stations?q=` station search
- `GET /api/departures?station=&limit=` board with delays
- `GET /api/route?from=&to=&time=` next trains between two stations
- `GET /api/train/:tripId` all stops, planned vs expected
- `GET /api/health` GTFS date, live API status

## Commands

- `bun install` installs root and `web/` dependencies
- `bun run dev` API server (3000) + Vite UI with hot reload: open http://localhost:5173
- `bun run build` build the UI into `dist/public/`
- `bun run start` serve API + built UI on port 3000 (run `bun run build` first)
- `bun run import-gtfs` rebuild SQLite from `data/gtfs/`
- `bun run typecheck` type-check server and web
- `bun test` run tests (bun:test, Vitest-compatible API)
- `bun run icons` regenerate the app icons
- `bun run fetch-font` download MÁV's MNR2007 badge font into `web/public/fonts/` (not in git)
- The server fills in sw.js's file list and content hash on each request, so no manual cache version bumps

## Conventions

- TypeScript strict mode. Validate live API responses with zod and fail soft
- Times stored as Europe/Budapest local times. Handle trips past midnight (GTFS times above 24:00)
- Keep dependencies few. Ask before adding a new one
- UI text in Hungarian. Code and comments in English
- Small commits, one feature each
