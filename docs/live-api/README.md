# Live API samples (mavplusz.hu)

Captured browser traffic from mavplusz.hu. No official docs exist; these files are
the only reference for `src/live/mavplusz.ts`. When the site changes, capture again
and replace the files.

## How to capture

1. Open https://mavplusz.hu in desktop Chrome or Edge.
2. Press F12, open **Network**, select **Fetch/XHR**, tick **Preserve log**, click the clear button.
3. Do the actions below one at a time. After each one, look at the new requests.
   Ignore analytics, fonts, images and map tiles. Keep requests that return train or station data (JSON).
4. For each useful request:
   - Right click it, **Copy > Copy as cURL (bash)**. Before pasting, delete the `Cookie:` line.
     If there is an `Authorization:` or token header, replace its value with `REDACTED` but keep the header name.
   - Open the **Response** tab, copy the JSON. If it is very long, cut long lists to 3 items,
     but keep one complete item of each kind.
5. Write down the time you did the capture and what the site showed (e.g. "IC 600, +12 perc, 5. vágány").

## What to capture

| # | Action on the site | File names | Needed for |
|---|---|---|---|
| 1 | Type "Keleti" into the station search and pick Budapest-Keleti | `01-station-search.*` | station ids/codes |
| 2 | Open the Budapest-Keleti departures board | `02-station-board.*` | departure board delays |
| 3 | Click a train on that board that is running right now, ideally a delayed one | `03-train-detail.*` | train detail, every stop |
| 4 | Search a train by number, if the site has that (e.g. an IC number) | `04-train-by-number.*` | lookup by train number |
| 5 | Optional: board of a small station (e.g. Szolnok or a village stop) | `05-small-station-board.*` | field differences |
| 6 | Optional: a cancelled train or one with a platform change | `06-cancelled-or-platform.*` | cancelled flag, platform |

Save each as `NN-name.request.sh` (the cURL command) and `NN-name.response.json`, plus a
`NN-name.notes.md` with the capture time and what the site showed.

## Rules (from CLAUDE.md)

- Only the server calls this API. Browsers never call MÁV directly.
- Every response is cached 30 to 60 s; one upstream request serves all users.
- Fetch only what a user is looking at (one station, one train). Never scrape.
- Normal browser User-Agent, no bursts, exponential backoff on errors (max 5 min).
- Never commit cookies or tokens.
