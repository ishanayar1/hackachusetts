# LastMile

LastMile is a mobile-friendly web app for people who can't use stairs: wheelchair users, parents with strollers, people with canes or heavy luggage. It shows which MBTA elevators, ramps and portable lifts are out of service right now, plans step-free subway trips that reroute around closures, tells you which station entrance to use, and lists things to watch for on the walk: poor curb ramps, open sidewalk reports and places with recorded pedestrian and bike crashes. Everything the map shows is also available as a text list.

Built for Hackachusetts 2026 (Civic Action track) in Kiro. Next.js 16 (App Router), React 19, MapLibre via react-map-gl, Tailwind 4, SWR.

## Run locally

Requires Node 22+.

```bash
npm ci
cp .env.example .env   # fill in MBTA_API_KEY, DATABASE_URL, BETTER_AUTH_SECRET
npm run db:migrate     # creates the user / session / account / verification tables
npm run dev            # http://localhost:3000
```

### Environment variables

| Name | Required | Notes |
|---|---|---|
| `MBTA_API_KEY` | Recommended | MBTA V3 API key ([get one free](https://api-v3.mbta.com/)). The code also accepts a variable named `mbta`. Without a key the app still works with lower MBTA rate limits. Server-only: never prefix it with `NEXT_PUBLIC_`. |
| `DATABASE_URL` | Yes, for sign-in | Postgres connection string. Use a free [Neon](https://neon.tech) database (pooled connection string) both locally and on Vercel. |
| `BETTER_AUTH_SECRET` | Yes, for sign-in | Random 32+ characters: `openssl rand -base64 32`. Use a different value in production. |
| `BETTER_AUTH_URL` | Yes, for sign-in | `http://localhost:3000` locally; the production URL on Vercel. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | Shows "Continue with Google". Redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google`. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional | Shows "Continue with GitHub". Callback URL: `<BETTER_AUTH_URL>/api/auth/callback/github`. |

Put them in `.env` (or `.env.local`). Both are gitignored; never commit a key. `.env.example` lists every variable.

### Accounts

[Better Auth](https://better-auth.com) handles sign-in (`/login`, API under `/api/auth/*`): email + password, plus Google and GitHub when their keys are set. Users, sessions and each user's starred stations (`user.myStations`) are stored in Postgres. Signed-out visitors keep stars in localStorage; on first sign-in on a device those stars merge into the account. Run `npm run db:migrate` after changing the auth config in `src/lib/server/auth.ts`.

### npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run db:migrate` | Create or update the Better Auth tables in `DATABASE_URL` |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit and property-based tests (Vitest + fast-check) |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build:data` | Rebuild `public/data/*.json` from the MBTA GTFS feed (`scripts/build-gtfs.ts`) |
| `npm run capture:demo` | Save a live MBTA alerts snapshot to `public/data/demo-alerts.json` for demo mode |
| `npm run mcp` | Start the MBTA MCP server used from Kiro (`mcp/mbta/server.ts`) |

## Docker

The image is a multi-stage `node:22-alpine` build of the Next.js standalone server, running as a non-root user. Keys are passed in at runtime via `env_file` and are never baked into the image (`.env*` is in `.dockerignore`).

```bash
docker compose up --build -d   # http://localhost:3000
docker compose logs -f web
docker compose down
```

`docker-compose.yml` loads `.env` and `.env.local` if present. Without compose:

```bash
docker build -t lastmile .
docker run --rm -p 3000:3000 -e MBTA_API_KEY=your-key lastmile
```

Note: phones need HTTPS for location, so use the Vercel link (not a LAN Docker URL) for phone testing.

## Deploy to Vercel

1. In the Vercel dashboard, choose **Add New > Project** and import the GitHub repo `ishanayar1/hackachusetts`.
2. Framework preset: **Next.js** (defaults for build command and output are fine; no `vercel.json` needed).
3. Under **Environment Variables**, add `MBTA_API_KEY` with your MBTA V3 key, plus `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your production URL) and any Google / GitHub keys (Production and Preview). Add the production callback URLs to the Google and GitHub OAuth apps.
4. Click **Deploy**.

`public/data/` is committed, so the build needs no downloads. API routes read those files at runtime; `next.config.ts` ships them with the functions via `outputFileTracingIncludes`. `output: 'standalone'` is only used by Docker and is ignored by Vercel.

## Data sources and attribution

- **MBTA**: GTFS static feed (stations, entrances, pathways, elevators, parking) and the V3 API (alerts, facilities, predictions, vehicles). Data provided by the Massachusetts Bay Transportation Authority under the [MBTA developer license](https://www.mbta.com/developers). Not an official MBTA product.
- **City of Boston / Analyze Boston** ([data.boston.gov](https://data.boston.gov)): Vision Zero crash records (shown as recorded crashes, historical, not live), 311 service requests (open sidewalk and street-light cases) and the Pedestrian Ramp Inventory.
- **Walking directions**: [Valhalla](https://github.com/valhalla/valhalla) public server (FOSSGIS, `valhalla1.openstreetmap.de`) with an OSRM foot-routing fallback, then a straight-line estimate. Walking legs are estimates.
- **Map**: [OpenFreeMap](https://openfreemap.org) tiles, map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

Crash records reflect police reporting and are not a measure of how dangerous a place is for any one trip.

## Crash-history pipeline (`crash-risk/`)

`crash-risk/` is a separate Python pipeline (pandas, scikit-learn, h3) over the Boston Vision Zero data in `vision-zero/data.csv`. It bins crashes into H3 res-9 hexagons, labels them with street names via OpenStreetMap Nominatim (cached in `geocache.json`) and writes `risk.geojson`, which it also copies to `public/data/crash-risk.geojson`. The Next.js app does not run any Python; it only reads that committed file and shows it as recorded crash history.

```bash
cd crash-risk
python3 -m pip install -r requirements.txt
python3 predict.py   # rebuilds risk.geojson and public/data/crash-risk.geojson
```

See `crash-risk/README.md` for details.

## Repo layout

- `src/app` – pages and API route handlers (`/api/alerts`, `/api/route`, `/api/walk`, `/api/stations`, ...)
- `src/lib` – routing, MBTA client, warnings, shared types (`src/lib/mbta/types.ts`)
- `public/data` – committed static data built by the scripts above
- `mcp/` – MBTA MCP server for Kiro; `.kiro/` – Kiro specs, steering and hooks
- `docs/` – plan and tech-stack notes
