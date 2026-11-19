# Mávy

Private PWA for Hungarian trains (MÁV, GYSEV): route search with changes, departure boards and
train details from the MÁV timetable, with live delays from vonatinfo.mav.hu.

Bun, TypeScript, Fastify, SQLite. Frontend: React, Tailwind, shadcn/ui in `web/`.

## Setup

Needs [Bun](https://bun.sh) 1.3+.

```bash
bun install
```

Timetable: request MÁV's GTFS feed at <https://www.mavcsoport.hu/gtfs-igenybejelento> (free),
put the zip in `data/gtfs/`, then:

```bash
bun run import-gtfs
bun run fetch-font    # optional: MÁV's badge font, not in git
bun run build
bun run start         # http://127.0.0.1:3000
```

## Development

```bash
bun run dev           # API + UI with hot reload: http://localhost:5173
bun test
bun run typecheck
```

Project rules and layout: `CLAUDE.md`.

## Configuration

| Env | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Listen address (`0.0.0.0` for all networks) |
| `MAVY_DB` | `data/mavy.db` | Timetable database |
| `MAVY_GTFS_DIR` | `data/gtfs` | Where `import-gtfs` looks for the zip |
| `MAVY_PASSWORD` | unset | Optional shared password (login page, 180-day cookie) |
| `MAVY_LIVE` | on | `off` shows planned times only |

## Hosting on Pelican

`deploy/supervisor.ts` serves the site and deploys every push to `main` with no downtime: it
builds and tests the new commit next to the live one and switches once it is healthy. A failed
build leaves the live version running.

1. Import `pelican/egg-mavy.json` in the panel and create a server from it.
2. Set **GitHub Token**: fine-grained, this repository only, *Contents: Read-only*. Add *Commit
   statuses* and *Deployments: Read and write* for build statuses on GitHub.
3. Install, upload the GTFS zip into `data/gtfs/`, press Start. The first start takes a few minutes.
4. Put HTTPS in front of it and set **Public URL**.

Updates:

- **Code:** push to `main`. Picked up within 2 minutes, or within seconds with a GitHub webhook to
  `<Public URL>/__deploy/github` (JSON, push events, **Deploy Webhook Secret** as secret).
- **Timetable:** upload a newer GTFS zip into `data/gtfs/`; it goes live within a minute.
- **Status:** `<Public URL>/__deploy/status`.
- Changes to `deploy/` itself take effect after a restart in Pelican.
