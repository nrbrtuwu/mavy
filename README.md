# Mávy

Private PWA for Hungarian trains (MÁV, GYSEV): route search, station departure boards and
train details from the MÁV GTFS timetable, with live delays when a live source is configured.
For the owner and a few friends, not a public service.

- Backend: Bun, TypeScript, Fastify, SQLite (`bun:sqlite`)
- Frontend: React, Tailwind, shadcn/ui in `web/`, built with Vite; installable PWA with offline cache
- UI text is Hungarian

## Setup

### 1. Install Bun

[Bun](https://bun.sh) 1.3 or newer. Windows (PowerShell):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

macOS / Linux:

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install dependencies

```bash
bun install
```

This installs the server and the `web/` frontend dependencies.

### 3. Get the MÁV timetable (GTFS)

The timetable is not in this repository: MÁV hands it out on request, and it must not be committed.

1. Request it at <https://www.mavcsoport.hu/gtfs-igenybejelento> (choose "Vasúti", rail). It is free,
   MÁV approves the request by e-mail.
2. Download the GTFS zip and put it in `data/gtfs/` (any file name ending in `.zip`; the newest one is used).
3. Import it into SQLite:

   ```bash
   bun run import-gtfs
   ```

   With an empty `data/gtfs/` it prints these instructions instead. Re-import when MÁV publishes a new
   feed; stop the server first, Windows keeps the database file locked while it runs.

### 4. Get MÁV's train badge font (optional)

Train badges (IC, S80, IR85 …) are drawn with MÁV's own badge font, MNR2007. It belongs to MÁV and is
not licensed for redistribution, so it is not in this repository. Download it from MÁV's ticket site:

```bash
bun run fetch-font
```

It lands in `web/public/fonts/` (gitignored) and goes into the next build. Without it the app shows
plain text badges.

### 5. Build and start

```bash
bun run build
bun run start
```

Open <http://127.0.0.1:3000>.

## Development

```bash
bun run dev
```

Runs the API server (port 3000, restarts on changes) and the UI with hot reload; open <http://localhost:5173>.

```bash
bun test              # tests (fake GTFS fixture, no real data needed)
bun run typecheck     # server and web
bun run icons         # regenerate the app icons
bun run fetch-font    # download MÁV's badge font (not in git)
```

`CLAUDE.md` describes the project rules, layout and design decisions.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Listen address. Keep it on loopback and put Tailscale or Cloudflare in front (see below). For a quick test on your own Wi-Fi use your machine's LAN address, e.g. `192.168.0.10`. |
| `MAVY_DB` | `data/mavy.db` | Timetable database |
| `MAVY_GTFS_DIR` | `data/gtfs` | Where `import-gtfs` looks for the zip |
| `MAVY_PASSWORD` | unset | Optional shared password, see below |

PowerShell example: `$env:HOST = '192.168.0.10'; $env:PORT = '3001'; bun run start`

In the app, the "Beállítások" item (gear icon) in the navbar opens the settings
(start page, animated background). Settings and favorites are stored on each device.

## Live delays

Not connected yet. MÁV's real-time data is requested through the Hungarian National Access Point
(<https://napportal.kozut.hu>) and approved case by case; see `docs/live-api/FINDINGS.md`.
Until then every screen shows planned times with a "Nincs élő késésadat" label.

## Private access

The app has no user accounts. Keep it off the public internet and put one of these in front.
All of them give HTTPS, which phones need to install the app and use it offline.

### Option A: Tailscale (recommended)

Only devices in your tailnet can reach the app. Nothing is exposed to the internet.

1. Install Tailscale on the machine that runs Mávy and on your phone, and sign in.
2. In the Tailscale admin console, enable MagicDNS and HTTPS certificates (DNS page).
3. Start Mávy as usual (it listens on 127.0.0.1:3000), then publish it inside the tailnet:
   ```bash
   tailscale serve --bg 3000
   ```
   It prints the address, like `https://<machine>.<tailnet>.ts.net/`.
4. Friends: share the machine with them from the admin console (Machines, the machine's menu, Share).
   They install Tailscale, accept the invite and open the same address.
5. On the phone, open the address and install: Android Chrome menu, "Install app";
   iOS Safari, Share, "Add to Home Screen".

Tailscale must be running on the phone whenever the app is used.

### Option B: Cloudflare Tunnel + Cloudflare Access

Reachable from any browser, but Cloudflare asks for a one-time e-mail code before the app loads.
Needs a domain on Cloudflare (free plan is enough).

1. Install `cloudflared` on the machine that runs Mávy, then create the tunnel and DNS record:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create mavy
   cloudflared tunnel route dns mavy mavy.example.com
   ```
2. `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: mavy
   credentials-file: /home/you/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: mavy.example.com
       service: http://localhost:3000
     - service: http_status:404
   ```
   Run it with `cloudflared tunnel run mavy` (or install it as a service).
3. In Cloudflare Zero Trust, add a self-hosted Access application for `mavy.example.com`
   with an Allow policy listing your friends' e-mail addresses, login method "One-time PIN".
   Set the session duration long (e.g. 1 month) so the installed app does not ask often.
4. Open `https://mavy.example.com`, log in with the e-mailed code, then install as above.

Do this setup before sharing the address: without step 3 the tunnel is public.

### Option C: shared password (fallback)

For when neither of the above fits, e.g. behind your own HTTPS reverse proxy. Can also be
combined with A or B.

```bash
MAVY_PASSWORD='a long passphrase' bun run start
```

- Visitors get a login page. A correct password sets a cookie valid for 180 days.
- Changing `MAVY_PASSWORD` logs everyone out.
- 10 wrong attempts from one address block it for 15 minutes.
- The login page, `manifest.webmanifest` and `icons/` stay public so the app can be
  installed. Everything else, including the API, needs the cookie.
- Only use it over HTTPS. Over plain http the password and the cookie travel in clear text.
  Behind a proxy on the same machine (tailscale serve, cloudflared, Caddy) the cookie is marked
  `Secure` automatically.
