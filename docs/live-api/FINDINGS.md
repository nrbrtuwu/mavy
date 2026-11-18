# mavplusz.hu findings (2026-11-12)

Captured in the Claude desktop app's browser pane on 2026-11-12 around 08:00 Budapest time.

## Backend

mavplusz.hu is an OpenTripPlanner 2 (OTP2) web UI. Endpoints, all under `https://mavplusz.hu//otp2-backend/otp/`:

| Endpoint | Method | Purpose |
|---|---|---|
| `auth/get-jwt` | POST `{ recaptchaToken }` | Exchanges a Google reCAPTCHA token for a JWT (HS256, `iss: otp2-backend`, `client_name: web`, valid 15 min) |
| `routers/default/index/graphql` | POST | OTP2 GraphQL API: stops, departures, trips, vehicle positions, planning |
| `routers/default/geocode/stations?q=&limit=&lang=` | GET | Station search (GeoJSON) |

The web client sends `Authorization: Bearer <jwt>`, `Accept-Language` and an optional `user-guid` header with
GraphQL requests. It refreshes the JWT with a new reCAPTCHA token on a timer.

## Blocker

Access to the live API is gated by reCAPTCHA: a JWT can only be obtained by sending a token produced by
Google reCAPTCHA in a real browser. A server-side client would have to obtain or fake reCAPTCHA tokens,
which means getting around MÁV's bot protection. Mávy does not do that.

## Official alternative: MÁV GTFS-RT via nap.mavcsoport.hu

MÁV's privacy notice for its developer data service
(`mavcsoport.hu/sites/default/files/upload/page/adatkezelesi_tajekoztato_gtfs_felulet_hozzaferes.pdf`,
PDF dated 2026-10-21) is titled "GTFS, GTFS-RT formátumú menetrendi terv és tény adatszolgáltatás"
(GTFS and GTFS-RT timetable plan and actual data service). It says registered users can view and download
planned and actual data in standard GTFS / GTFS-RT formats, based on EU requirements.

- Registration and request: https://nap.mavcsoport.hu/igenybejelento.php (account, then MÁV approves by e-mail).
  Requires contact name, phone, e-mail; company fields if applicable.
- The older form at https://www.mavcsoport.hu/gtfs-igenybejelento covers the static GTFS (rail, bus or both).
- Not yet known: GTFS-RT endpoint URLs, which feeds (TripUpdates / VehiclePositions / Alerts),
  update interval, rate limits, licence terms. These are only visible after registration.
- nap.mavcsoport.hu refused connections from Claude's environment on 2026-11-12; try it from your own browser.

## Update 2026-11-12: where access is actually requested

- nap.mavcsoport.hu does not load (neither for the owner nor from Claude's environment).
- holavonat.hu (post of 2025-07-24) found that MÁV's real-time rail vehicle positions are listed in the
  Hungarian National Access Point run by Magyar Közút, dated 2025-01-10:
  https://napportal.kozut.hu/#/configuration/data-provider/profile/multimodal/7
  Access is requested by e-mail to an address shown on that NAP page (shown as an image in their post).
  MÁV replied with two questions (which interface, what purpose) and said MÁV Személyszállítási Zrt.'s
  management decides, with no deadline or criteria given.
- Telex, 2025-08-14: MÁV had not granted access to holavonat or BKK. EU regulation 2024/490 requires
  real-time data via the NAP (TEN-T core network by end of 2025, rest by December 2028), "where appropriate,
  subject to registration".
- Portfolio, 2026-06-08: the Vonatinfo tracker is back online; the minister said live data will be integrated
  into MÁV+ "soon". No public developer feed announced.
- The NAP portal is a slow Angular app; it did not finish loading in Claude's browser pane.

## Update 2026-11-16: emma.mav.hu and the NAP listing

- github.com/doomhyena/MAVTracker (archived 2025-12-28) proxied
  `https://emma.mav.hu/otp2-backend/otp/routers/default/index/graphql` without any token. Today that URL
  answers `302` to `https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql`, i.e. the same
  reCAPTCHA-gated backend as above. Not usable.
- NAP lists exactly four MÁV datasets: rail + GYSEV GTFS, bus GTFS, rail vehicle positions (GTFS-RT),
  bus vehicle positions (GTFS-RT). No TripUpdates, no Alerts. The rail GTFS-RT listing has URL `#` and the
  format description "Átalakítás alatt…" (under construction); update interval stated as 5 minutes.
  Access details have to be requested from MÁV by e-mail.

## Useful facts for any future live source

- IDs are GTFS ids with feed prefix `1:`: trips `1:35051201`, stops `1:005510017_6` (platform-level, `_N` suffix),
  stations `1:005510017_0`. The station code `005510017` is the UIC-style code also used in station search.
  These very likely equal the MÁV GTFS `trip_id` / `stop_id` values, so matching is by trip_id + service date.
- `tripShortName` is train number + localized category text: `"519 TOKAJ InterCity"`, `"33422 passenger train"`.
- `serviceDate` is `YYYY-MM-DD`. Scheduled and realtime times are seconds after service-day start (GTFS style).
  Delays (`arrivalDelay`, `departureDelay`) are in seconds.
- Agencies include MÁV, MÁV HÉV, Volánbusz (`hkir:`), BKK (`BKK:`) and other city operators.

## Update 2026-11-18: vonatinfo.mav.hu works (now the live source)

MÁV's public train map. One JSON endpoint, no login, cookie, token or captcha:
`POST https://vonatinfo.mav.hu/map.aspx/getData`, body `{ "a": <action>, "jo": { ... } }`, answer
`{ "d": { "result": ... } }` (gzip). Sent with a normal browser User-Agent and `Referer: https://vonatinfo.mav.hu/`.

| Action | `jo` | Answer | Used |
|---|---|---|---|
| `TRAINS` | `{ history: false, id: false }` | every GPS-tracked train in the country (~300 at 10:00): `@TrainNumber` (`55` + number), `@Delay` (min), `@Relation`, `@Lat`/`@Lon`, `@ElviraID` (`9339646_261118`, suffix = YYMMDD), sometimes `@Line`. No reasons, no stops | no (whole country) |
| `TRAIN` | `{ vsz: "55141" }` or `{ v: <ElviraID> }` | `{ html, line }`: stop table with km, planned arr/dep, actual (red) or predicted (red italic) times, platform, "A pillanatnyi késés N perc", delay reason on red background | yes |
| `STATION` | `{ a: "Budapest-Keleti", d: "26.11.18" }` | HTML string: today's board, arrivals and departures, planned + red actual/predicted time, platform, train number + ElviraID, destination; a hidden row per train with the current delay and reason | yes |

Findings:
- `TRAIN` by number ignores a date parameter and always answers with today's run, so a train still
  running after midnight from yesterday gets no live detail (planned times only).
- Rows the train has passed have class `row_past_*`. Foreign stops have no km, no live times.
- Red-background notices are either delay reasons ("Pálya állapota miatti késés", "Más vonat által okozott
  késés", "Társvasúttól átvett késés", "Biztosítóberendezési hiba miatti késés") or service notes
  ("Kisebb ülőhely-kapacitású szerelvénnyel közlekedik."). Only the ones about delays or cancellation are kept.
- Two delay numbers, used for different things (owner's choice): "+N perc" shows the train's delay right now
  ("A pillanatnyi késés N perc"; on boards `currentDelayMin`), while the time under the planned time is the station's
  own predicted time, which is more accurate (e.g. EC 141: +23 now, but predicted to reach Keleti 15 min late).
- Route results load two boards (departure and arrival station, both cached). The arrival time is the arrival
  station's own prediction for the same train (live number + date + planned arrival). Boards only predict trains
  that are close (Győr's board had no time for S10 4926 an hour out, its train page said on time), so for
  connections still without one the server asks the train page (TRAIN, at most 3 per search, cached). Only
  without any prediction is the departure delay carried over.
- A train gets a red time at a station only once it is running; trains that start later show planned times only.
- Cancelled-train markup has not been seen yet; `cancelled` stays false until it is captured.
- MÁV's GTFS has no train number for S/Z/IR trips (`trip_short_name` empty). Those are matched to the live
  board by planned departure time + destination, only when exactly one live row fits (`src/merge.ts`).
- Samples: `test/fixtures/vonatinfo/` (captured 2026-11-18 ~10:10).
