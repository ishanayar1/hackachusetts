# LastMile Tech Stack

## Decision: React + Next.js

We're building LastMile as a **Next.js (App Router) web app in React and TypeScript**, installable on phones as a PWA and hosted on Vercel.

**Why Next.js**
- **Opens on any phone from a link.** Judges tap the test link and it works. No app store, no installer.
- **One project for both sides.** Pages *and* server API routes (`route.ts`) that proxy, cache and retry MBTA calls. No separate backend.
- **AI agents write React most reliably**, Kiro included, because there's more React in their training data than anything else.
- **Ready-made parts:** shadcn/ui gives us a mobile bottom sheet (Drawer), react-map-gl wraps the map, SWR handles live polling.
- **Vercel is built for Next.js:** free hosting, HTTPS, a preview link for every push.

**Why not the others:** Electron only builds desktop apps. React Native, Expo, Flutter and native apps need app installs or two builds. SvelteKit would also work, but React is the team's pick and gets better AI help.

## How the map works (in plain words)

A map in our app has three pieces:

1. **OpenStreetMap = the information.** It's like Wikipedia for maps: volunteers record every street, sidewalk, building and park. It's data, not a picture.
2. **OpenFreeMap = the delivery service.** It cuts the OpenStreetMap data into small squares (tiles) and sends them to the phone. It's free, with no account or key.
3. **MapLibre = the screen in our app.** It draws those squares into a map you can zoom and drag. We draw our own layers on top: trains, broken elevators, crash zones, hazards.

```
OpenStreetMap (street info)  →  OpenFreeMap (sends map pieces)  →  MapLibre (draws the map in our app)
```

We don't use OpenStreetMap's own map servers directly: they're for light use only, so a busy app can get blocked. Google Maps and Mapbox need billing or keys.

There's a fourth piece we use for *names*, not pictures: **Nominatim = the address book.** OpenFreeMap sends map pictures but can't tell you "what street is at this point." Nominatim is OpenStreetMap's free geocoder that turns a latitude/longitude into a human name like "Blue Hill Avenue, Roxbury." It's free with no key, but rate-limited (about 1 request per second, and it wants a `User-Agent` that identifies the app), so we call it **once, offline, in a build script and cache the results** rather than from the browser.

```
OpenStreetMap (street info)  →  OpenFreeMap (map pictures)   →  MapLibre (draws the map)
                             →  Nominatim    (point → name)  →  cached into our data
```

**Backup:** OpenFreeMap is a free community service, so if it fails to load we switch one line to a backup style built on OpenStreetMap's standard image tiles. The map still shows streets, just less polished. Show "© OpenStreetMap contributors" on the map; the license requires it.

## Crash-risk app: the map stack in practice (`crash-risk/`)

The crash-risk prediction app in `crash-risk/` is a working reference for the map
stack above. It's a standalone Python + vanilla-JS app (not Next.js), but the
map pieces are identical, so it's a good proof that this stack works with no
keys.

- **Basemap:** MapLibre GL JS loads the OpenFreeMap "liberty" vector style
  (`tiles.openfreemap.org/styles/liberty`). No key, no `.env`.
- **Our data on top:** the predicted crash risk per area is drawn as a GeoJSON
  **`<Source>` + fill/line layers** of H3 hexagons, colored by risk — exactly the
  "GeoJSON layers, not hundreds of markers" rule. A toggle shows/hides the hexagon
  overlay while the OpenFreeMap basemap stays visible.
- **Names:** each hexagon's center is reverse-geocoded with **OSM Nominatim** into
  a street + neighborhood label (e.g. "Blue Hill Avenue, Roxbury"), run once in
  `predict.py` and cached to `geocache.json` so the live app makes zero geocoding
  calls. The labels power the searchable location list and the map popups.
- **Risk layers are inserted below the basemap's label layers**, so OpenFreeMap's
  own street and place names always stay readable on top of our colors.

Takeaway for LastMile: the same OpenFreeMap + MapLibre + Nominatim combination
covers both the basemap and human-readable place names with no billing, keys, or
accounts. For LastMile we use the React wrapper (`react-map-gl/maplibre`) instead
of raw MapLibre, and ship risk as 250 m grid cells rather than hexagons.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for the app, server routes, data scripts and the MCP server |
| Framework | **Next.js (App Router) + React 19** | Pages plus server API routes in one project |
| Styling | **Tailwind CSS** | Fast, mobile-first responsive layouts |
| UI components | **shadcn/ui**, especially **Drawer** for the bottom sheet | Accessible, copy-in components; the Drawer is a ready-made mobile bottom sheet |
| Map | **MapLibre GL JS** through **react-map-gl** (`react-map-gl/maplibre`) | Free, GPU-drawn, smooth on phones with thousands of points |
| Base map tiles | **OpenFreeMap** (`tiles.openfreemap.org/styles/positron` or `liberty`) | Free, no key (checked live) |
| Live data in the browser | **SWR** with `refreshInterval` | Polls our API every 15–30 s and pauses when the tab is hidden |
| Geo math | **@turf/turf** | Distance, nearest station, "is this hazard near my route" |
| Polylines | **@mapbox/polyline** | Decode MBTA shapes (precision 5) and Valhalla routes (**precision 6**) |
| Station router | **Our own Dijkstra in TypeScript** over the GTFS station graph | About 125 stations, so a 50-line function beats a library. Easy to property-test |
| Walking router | **Valhalla** public server (wheelchair mode) → OSRM foot → straight line | No key. OpenRouteService signups are down |
| Server cache | **Vercel CDN caching** (`Cache-Control: s-maxage=…, stale-while-revalidate=…`) plus an in-memory cache and the fallback chain | Serverless instances don't share memory, so the CDN cache is what keeps MBTA calls low |
| PWA | **`app/manifest.ts`** (built into Next.js) for Add to Home Screen; **Serwist** (`@serwist/next`) only if we want offline caching | Installable from the browser |
| Data build scripts | **TypeScript run with `tsx`**: `fflate` to unzip GTFS, `csv-parse` for CSVs | Turns GTFS, Vision Zero, 311 and parking into small JSON in `public/data/` |
| Crash grid | **Reuse `research/crash-backtest/crash_bt.py`** (Python, standard library only), or port it to TS | Already works and was backtested |
| Tests | **Vitest + fast-check** | Property-based tests, which Kiro judging rewards |
| MCP server | **@modelcontextprotocol/sdk** (TypeScript, stdio) | Gives Kiro live MBTA tools while we build |
| LLM (optional) | **Claude Haiku 5.5** (`claude-haiku-5-5`) through the Anthropic API or Amazon Bedrock, server-only | Cheap and fast for translating alerts. Skip if no key |
| Hosting | **Vercel** | Free, HTTPS by default (phones need HTTPS for location), preview link per push |
| Containers | **Docker** (Next.js standalone image + docker compose) | Same setup on every laptop, anyone can run the app with one command, backup deploy option |
| Repo | **Public GitHub** with `/.kiro` at the root | Required by the rules |

## How a request flows

```
Phone (Next.js page, React, MapLibre)
   │  SWR polls /api/alerts, /api/vehicles, /api/predictions?stop=…, /api/walk?from=…&to=…
   ▼
Vercel CDN cache  (s-maxage 15–30 s; most requests stop here)
   ▼
Next.js route handler  src/app/api/*/route.ts
   │  src/lib/server/mbta.ts: in-memory cache → retries → fallback chain
   ├──► api-v3.mbta.com            (x-api-key from process.env, server-only)
   ├──► cdn.mbta.com/realtime/*    (fallback, no key)
   ├──► valhalla1.openstreetmap.de (walking) → routing.openstreetmap.de (fallback)
   └──► public/data/demo-*.json    (last resort, always works)

Static JSON built before deploy (scripts/ → public/data/):
   stations, elevators/pathways graph, route shapes, parking lots, crash grid, 311 hazards
```

## Making it work well on phones

- **Layout:** a full-screen map with a **bottom sheet** (shadcn Drawer) for the trip, alerts and station details. Thumb-reachable buttons at the bottom.
- **Touch targets at least 44 px.** Our users include people with limited dexterity.
- **The app itself must be accessible:** real `<button>` elements, screen-reader labels, visible focus, WCAG AA contrast, text that scales. Judges will check this for an accessibility app.
- **Safe areas:** set `viewportFit: 'cover'` in Next's `viewport` export and pad with `env(safe-area-inset-*)` so nothing hides under the notch or home bar.
- **Location needs HTTPS.** On a phone it only works on the Vercel URL or localhost, not `http://192.168.x.x`. Test on phones with Vercel preview deploys, or run `next dev --experimental-https`.
- **Keep the map light:** draw trains, stations, crash cells and hazards as GeoJSON layers (`<Source>` + `<Layer>`), not hundreds of React `<Marker>`s. Ship crash data as 250 m grid cells, not 45k points.
- **The map is client-only:** MapLibre needs `window`, so the map component starts with `'use client'` and is loaded with `next/dynamic` and `ssr: false`.
- **Installable:** `app/manifest.ts` with icons and a theme color. iPhone web push only works after installing, which is why push is a stretch goal.
- **Poll politely:** SWR refreshes vehicles every 15 s and alerts every 30 s, and stops while the tab is hidden.

## Project layout

```
lastmile/
  .kiro/                 steering/, specs/, hooks/, settings/mcp.json
  docs/                  lastmile-plan.md, mbta-v3-reference.md, tech-stack.md
  scripts/               build-gtfs.ts, build-crash-grid (py or ts), build-311-hazards.ts, build-parking.ts
  public/data/           stations.json, graph.json, shapes.json, parking.json, crash-grid.json, hazards.json, demo-alerts.json
  mcp/mbta/              MCP server (TypeScript)
  src/
    app/
      page.tsx           map + bottom sheet
      station/[id]/page.tsx   elevators, next trains, parking
      api/alerts/route.ts
      api/vehicles/route.ts
      api/predictions/route.ts
      api/walk/route.ts
      manifest.ts
      layout.tsx         viewport + safe areas
    components/
      Map.tsx            'use client'; loaded with next/dynamic, ssr: false
      AlertFeed.tsx, TripSheet.tsx, StationCard.tsx
    lib/
      server/mbta.ts     import 'server-only'; cache, retries, fallbacks
      server/walk.ts     Valhalla → OSRM → straight line
      router.ts          step-free Dijkstra over the station graph
      safety.ts          crash and hazard checks along a route
  tests/                 router.property.test.ts, alerts.test.ts
  .env.example           MBTA_API_KEY=, ANTHROPIC_API_KEY=   (real values in .env.local, gitignored)
  Dockerfile, docker-compose.yml, .dockerignore
```

## Setup commands

```bash
npx create-next-app@latest lastmile
```
Pick: TypeScript, ESLint, Tailwind, `src/` directory, App Router.

```bash
npm i maplibre-gl react-map-gl @turf/turf @mapbox/polyline swr server-only
```

```bash
npx shadcn@latest init
```

```bash
npx shadcn@latest add drawer button badge
```

```bash
npm i -D vitest fast-check tsx fflate csv-parse @modelcontextprotocol/sdk
```

## Docker

**Yes, we dockerize, but the judges' link stays on Vercel.** Vercel doesn't run Docker containers. It builds Next.js itself, gives us HTTPS and never sleeps. Docker is for everything else:

- **Same setup on every laptop:** one command, no "works on my machine."
- **Anyone can run it:** a judge or teammate runs `docker compose up` and gets the full app.
- **Backup deploy:** if Vercel has trouble, the same image runs on any container host.
- **Bonus:** as one long-running server, the in-memory MBTA cache is shared by every user. On Vercel, the CDN cache does that job instead.

**Before using a Docker host as the main link:** most free container hosts either go to sleep when idle (the first load can take 30+ seconds, bad for judges) or need a credit card. Check that before relying on one.

**1. In `next.config.ts`**, set `output: 'standalone'` so Next.js produces a small self-contained server.

**2. `Dockerfile`**
```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

**3. `docker-compose.yml`**
```yaml
services:
  web:
    build: .
    ports: ["3000:3000"]
    env_file: .env.local
    restart: unless-stopped
```

**4. `.dockerignore`**
```
node_modules
.next
.git
.env*
!.env.example
research
docs
.kiro
```

**Run it:**
```bash
docker compose up --build
```
Then open http://localhost:3000.

**Docker rules**
- **Keys are never baked into the image.** They come in at runtime through `env_file`. No `ARG` or `ENV` lines with secrets, and `.env*` is in `.dockerignore`.
- **Commit the generated `public/data/*.json`** so the image build doesn't depend on downloading GTFS or crash data. Rerun the data scripts by hand when we want fresh data.
- **Phones still need HTTPS for location**, so a Docker container on your laptop (`http://192.168…`) won't do location on a phone. Use the Vercel link for phone testing.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `MBTA_API_KEY` | `.env.local` locally, Vercel project settings | Read with `process.env` in server files only. **Never** prefix it with `NEXT_PUBLIC_`, which would ship it to every browser |
| `ANTHROPIC_API_KEY` (optional) | same | Only if we do translation |

`.env.local` is gitignored. `.env.example` (no values) is committed. `.kiro/` is committed.

## Rules for AI agents (put in `.kiro/steering/tech.md`)

1. **App Router only** (`src/app`). No `pages/` directory.
2. Secrets live only in route handlers and `src/lib/server/` files that start with `import 'server-only'`. Never use `NEXT_PUBLIC_` for keys.
3. Map components start with `'use client'` and are loaded with `next/dynamic` and `ssr: false`.
4. Every route handler sets `export const dynamic = 'force-dynamic'` and a `Cache-Control` header with `s-maxage` and `stale-while-revalidate`, and returns `{ data, source, ageSec }`, where source is `v3`, `cdn`, `cache` or `demo`.
5. Live data in the browser uses SWR with `refreshInterval`, not hand-written `setInterval` loops.
6. Map features go in GeoJSON `<Source>` + `<Layer>` layers, not many `<Marker>` components.
7. Valhalla polylines are precision 6; MBTA shapes are precision 5.
8. Mobile first: design at 375 px wide first, touch targets at least 44 px, shadcn Drawer for the bottom sheet.
9. Tests use Vitest; property tests use fast-check.

## What we're not using, and why

| Not using | Why |
|---|---|
| Electron | Desktop apps only. Doesn't run on phones |
| React Native / Expo / Flutter / native apps | Judges would need app installs; two builds and different map libraries |
| SvelteKit | Would work too, but React gets better AI help and is the team's pick |
| Google Maps or Mapbox | Need billing or keys. MapLibre and OpenFreeMap are free |
| OpenStreetMap's own tile servers | For light use only; a busy app can get blocked |
| OpenRouteService | Signups are down. Valhalla replaces it |
| A database | Nothing needs one. Static JSON plus cached live calls. "My stations" lives in `localStorage` |
| MBTA streaming (SSE) | Needs a key and long-lived connections, which don't fit serverless. Polling with CDN caching is simpler |
| Exa / web search | All our data comes from structured public APIs |
