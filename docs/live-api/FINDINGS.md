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

## Useful facts for any future live source

- IDs are GTFS ids with feed prefix `1:`: trips `1:35051201`, stops `1:005510017_6` (platform-level, `_N` suffix),
  stations `1:005510017_0`. The station code `005510017` is the UIC-style code also used in station search.
  These very likely equal the MÁV GTFS `trip_id` / `stop_id` values, so matching is by trip_id + service date.
- `tripShortName` is train number + localized category text: `"519 TOKAJ InterCity"`, `"33422 passenger train"`.
- `serviceDate` is `YYYY-MM-DD`. Scheduled and realtime times are seconds after service-day start (GTFS style).
  Delays (`arrivalDelay`, `departureDelay`) are in seconds.
- Agencies include MÁV, MÁV HÉV, Volánbusz (`hkir:`), BKK (`BKK:`) and other city operators.
