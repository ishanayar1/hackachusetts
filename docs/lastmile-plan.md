# LastMile: Team Brief

Hackachusetts · Saturday, Oct 24, 2026 · Civic Action track (V3: safer, connected places) · Built in Kiro

## Overview

**LastMile** is a mobile-friendly web app for people who can't use stairs. It shows a live map of MBTA subway trains and which elevators and escalators are broken right now. It plans step-free trips that reroute around closures, and it warns about crash hotspots on the walk, using our own tested crash predictions.

**Who it's for:** wheelchair users, parents with strollers, people with canes, injuries or heavy luggage, and older riders. Today they often find out about a broken elevator only when they reach the platform.

**Why it can win**
- A clear user and a clear equity story (judging: potential value).
- Live public data plus a 20-second demo moment: pick Park Street, see "elevator out", watch the route recalculate.
- Real Kiro work (judging: implementation): an MBTA MCP server, specs, property-based tests ("never route through a closed elevator"), steering docs and hooks.

**Stack:** TypeScript, React + Next.js (App Router) as an installable mobile web app (PWA), Tailwind and shadcn/ui, MapLibre (via react-map-gl) with OpenFreeMap tiles (no key), Next.js route handlers that cache every MBTA call, hosted on Vercel, built in Kiro. Full details are in the Tech stack tab (`docs/tech-stack.md`).

### Before 11:30
- [ ] Get the free **MBTA V3 API key** at api-v3.mbta.com. Without it the whole venue shares 20 requests a minute.
- [ ] Nothing to sign up for walking routes. OpenRouteService signups are down, so we use the free public **Valhalla** server (`valhalla1.openstreetmap.de`, no key), which has a wheelchair mode.
- [ ] Optional: an **LLM key** (Bedrock or similar). It's only used for plain-language alerts and translation. Kiro credits don't pay for your app's LLM calls.
- [ ] Create the **public GitHub repo**. Keep `/.kiro` at the root and **not** in `.gitignore`; keep `.env.local` gitignored.
- [ ] Agree on scope and who builds what (see Build plan).

### Corrections from live checks
These were checked against the real APIs on the morning of Oct 24. Earlier versions of the plan got them wrong.
1. **There's no curb-ramp category in Boston 311.** The real walking hazards are *Sidewalk Repair* (2,745 cases), *Illegally Blocked Sidewalk* (1,840) and *Street Light Outage* (4,482).
2. **Crash data isn't live.** The latest Vision Zero record is from **Sept 1, 2026**. The crash layer shows history plus our own predictions. The live parts are MBTA (seconds old) and 311 (through yesterday).
3. **Boston's crash data has no severity, speed limit or road type**, so the severity and speed-limit charts in the organizers' SafeStreets mockup can't honestly be built for Boston. We have mode (car, pedestrian, bike), time, location, and a separate 162-record fatalities dataset.
4. **MBTA live streaming (SSE) needs an API key.** It returned 406 without one. We poll with a server-side cache instead.

### Key numbers (live, Oct 24 morning)
| What | Count |
|---|---|
| MBTA alerts right now | 142 (16 elevator, 20 escalator, 4 shuttle, 6 suspension, 9 moved stops, 28 detours) |
| Subway trains on the live map | 79 |
| Elevators in the system | 237 (IDs match across alerts, `/facilities` and GTFS) |
| In-station paths in GTFS | 9,325 (490 elevator rows) |
| Vision Zero crashes | 44,986 (2015 to Sept 2026) |
| Boston 311 cases with lat/long | 75,498 (Aug 2025 to yesterday) |
| MBTA parking lots | 169 (13 at subway stations; 149 list accessible spaces) |

## Features & data

Every source below was called live. "Free key" means sign up and get it instantly.

| # | Feature | Data source | Live check | Priority |
|---|---|---|---|---|
| 1 | **Live train map**: trains moving on the map | MBTA `/vehicles` | ✅ 79 subway trains with lat/long, updated seconds ago | Must |
| 2 | **Stations colored by step-free status** | GTFS `stops.txt` / MBTA `/stops` (`wheelchair_boarding`) | ✅ 101 accessible and 24 inaccessible subway stations | Must |
| 3 | **"What's broken now" feed** | MBTA `/alerts` (always with `filter[activity]=ALL`) | ✅ 142 alerts; 39 on the subway right now | Must |
| 4 | **Know which elevator your route uses** | GTFS `pathways.txt` + `facilities.txt` (`cdn.mbta.com/MBTA_GTFS.zip`) | ✅ 185 of 188 subway elevators have path records; IDs match alerts | Must |
| 5 | **Step-free trip planner and reroute** | Station graph built from GTFS route patterns, minus elevators with active closure alerts | Built by us from verified data | Must |
| 6 | **Wheelchair walking directions** | Valhalla public server (`valhalla1.openstreetmap.de/route`, no key), `costing: pedestrian` with `type: wheelchair`, `max_grade`, `step_penalty`. Fallback: OSRM foot (`routing.openstreetmap.de/routed-foot`), then a straight line | ✅ Park St to Downtown Crossing: 0.89 km, 13.1 min in wheelchair mode vs 10.3 min on foot, turn-by-turn steps and route shape | Must |
| 7 | **Crash zones map**, filterable by mode and time | Vision Zero crash records (data.boston.gov) | ✅ 44,986 crashes with lat/long: 33.9k car, 7.0k pedestrian, 4.1k bike | Must |
| 8 | **Crash-risk prediction** (our own) | Precomputed from Vision Zero history | ✅ Backtested: top 5% of blocks catch 27% of future ped/bike crashes | Must |
| 9 | **Fatal crash markers** | Vision Zero fatality records | ✅ 162 records with lat/long | Should |
| 10 | **Resident-reported danger spots** | Vision Zero Safety Concerns | ✅ 670 points with a type (e.g. "speeding") | Should |
| 11 | **Hazards on your walk** | Boston 311 open cases (Sidewalk Repair, Blocked Sidewalk, Street Light Outage) | ✅ Has lat/long, current through yesterday | Must |
| 12 | **My stations**: in-app alert when one breaks | MBTA `/alerts`, cached 30 s | ✅ | Must |
| 13 | **Next trains at a station** | MBTA `/predictions` | ✅ Needs cleanup (drop past and cancelled rows) | Should |
| 14 | **Plain-language alerts and translation** | Our LLM key | Optional | Should |
| 15 | **Weather on the walking leg** | `api.weather.gov` (no key) | ✅ | Stretch |
| 16 | **Bluebikes as an alternative** | Bluebikes live feed (`gbfs.bluebikes.com`) | ✅ Live `station_status` | Stretch |
| 17 | **Equity view**: who lost step-free access | MassGIS environmental-justice block groups | ✅ 462 Boston block groups | Stretch |
| 18 | **Base map** | OpenFreeMap tiles (no key) | ✅ | Must |
| 19 | **Accessible park & ride**: stations with accessible parking *and* working elevators, e.g. "Wollaston's elevator is out; the nearest station with accessible parking and working elevators is Quincy Center" | MBTA `/facilities?filter[type]=PARKING_AREA` (or GTFS `facilities.txt` + `facilities_properties.txt`) for capacity, `capacity-accessible`, `fee-daily`, `payment-app`, `overnight-allowed`; plus `PARKING_ISSUE` / `PARKING_CLOSURE` alerts and elevator alerts | ✅ 169 lots, 13 at subway stations (Wollaston 531 spaces / 12 accessible, Forest Hills 217 / 7, Orient Heights 411 / 8, Wonderland 476 / 11). `/live_facilities` returned **no live occupancy**, so we never claim "spots free now" | Stretch |

**Scope:** subway only (Red, Orange, Blue, Green B/C/D/E, Mattapan). The Silver Line is filed as a bus route in the API, so it's a stretch goal. Commuter rail and buses are out.

## Risks

| Risk | What could go wrong | Fix |
|---|---|---|
| **Scope** | A "full-fledged app" in about 8 hours is the number one way to lose. | Feature freeze at **5:30 PM**. Subway only. Stretch items only after the Musts work. |
| **Trip planner** | A real timetable router is too hard for one day. | Station-to-station shortest path on about 125 stations plus a walk to the nearest step-free station. Live arrivals are display only. |
| **Elevator matching** | Alert IDs might not line up with station paths. | Already checked: 185 of 188 subway elevators match. Still test the join first in Phase 1. Each elevator appears as two one-way rows, so close both. |
| **Demo luck** | No useful outage live during the demo. | Save today's real alerts to a file and add a "demo mode" that replays them. |
| **Rate limit** | 20 requests a minute without a key, shared by every user and the whole venue wifi. | Get the free key (1,000 a minute). Proxy and cache every call on the server. |
| **Silent alert loss** | Elevator alerts disappear unless `filter[activity]=ALL` is sent. | Always send it. Add a test for it. |
| **Leaked keys** | The rules require a public repo. | Keys only in env vars. `.env.local` gitignored, `.kiro` not. A Kiro hook blocks commits containing keys. |
| **Misleading crash map** | Raw counts mostly show busy streets. | Call them "recorded crashes," never "dangerous." Default to pedestrian and bike. Show the "How we know" backtest panel. |
| **Data size on phones** | 45k crashes and 75k 311 cases are too much for a phone browser. | Pre-group points into 250 m grid cells with a build script and ship small JSON. |
| **Push notifications** | iPhones only allow web push for home-screen apps, and free hosting won't run a background checker reliably. | Alerts show in the app while it's open. Push is a stretch goal, demoed on Android or desktop. |
| **Location** | Live location fails indoors or gets blocked. | Add a "pretend I'm at Park Street" button. |
| **LLM cost** | Kiro credits don't cover the app's LLM calls. | Bring your own key. Keep the LLM optional (alert text is already English). |
| **Walking routes** | OpenRouteService signups are down. The free Valhalla server is a shared public service meant for light use, and wheelchair data in OpenStreetMap is patchy. | Use Valhalla (no key). Cache every route on our server, pre-compute the demo routes, and fall back to OSRM foot routing, then a straight line. Label walking legs as estimates. |
| **Everyone builds SafeStreets** | It's the organizers' sample idea, so many teams will ship a crash dashboard. | Lead with step-free live rerouting. The crash layer supports it; it isn't the product. |
| **Kiro judging** | Kiro use is scored, and too little can disqualify. | Set up steering, specs and hooks first, not at 7 PM. |

## Build plan

### Repo structure
```
lastmile/
  .kiro/
    steering/   product.md, tech.md, data-sources.md, accessibility-language.md
    specs/      router/ alerts/ crash-map/  (requirements, design, tasks)
    hooks/      run router tests on save, block commits containing keys
    settings/mcp.json   → MBTA MCP server
  mcp/mbta/            MCP server: alerts, facilities, stops, vehicles
  scripts/             build-gtfs (station graph, elevators, shapes, parking), build-crash-grid, build-311-hazards
  public/data/         stations.json, graph.json, shapes.json, parking.json, crash-grid.json, hazards.json, demo-alerts.json
  src/                 (Next.js App Router + React PWA)
    app/               page.tsx (map + bottom sheet) · station/[id] · api/alerts · api/vehicles · api/predictions · api/walk · manifest.ts
    components/        Map.tsx ('use client', no SSR) · AlertFeed · TripSheet · StationCard
    lib/server/        mbta.ts (server-only: cache, retries, fallbacks) · walk.ts (Valhalla → OSRM → straight line)
    lib/               router.ts (step-free Dijkstra) · safety.ts (crash + hazard checks)
  tests/               property-based tests (Vitest + fast-check)
  docs/                lastmile-plan.md, mbta-v3-reference.md, tech-stack.md
  Dockerfile, docker-compose.yml, .dockerignore   (Next.js standalone image; keys passed at runtime, never baked in)
```

### Phases (hacking starts at 11:30)
| When | Phase | Done when |
|---|---|---|
| Now–11:30 | **Setup**: keys, repo, Kiro steering and specs (planning only; code starts at 11:30) | Keys in hand, specs written |
| 11:30–1:00 | **Data**: GTFS station graph, elevator join test, crash grid and predictions, 311 hazards, cached MBTA API layer with fallbacks | JSON files built, elevator join confirmed |
| 1:00–3:00 | **Live map**: moving trains, step-free stations, broken-now feed, crash and hazard layers | Usable on a phone |
| 3:00–4:30 | **Trip planner**: step-free route, reroute around closures, wheelchair walking leg, crash warnings on the route | Park Street reroute works |
| 4:30–5:30 | **Polish**: My Stations alerts, translation, demo mode, mobile and PWA | **Feature freeze 5:30** |
| 5:30–6:30 | **Ship**: deploy, README, Kiro write-up, test link | Live URL works |
| 6:30–7:30 | **Submit**: record the video (under 3 min), upload to YouTube, submit on SundAI | Submitted 30 minutes early |

### Suggested split (if 2–4 people)
| Person | Owns |
|---|---|
| A | Data scripts (GTFS graph, crash grid, 311 hazards) and the router with its property tests |
| B | Map UI: train layer, station status, crash and hazard layers, mobile layout |
| C | Server API layer: MBTA client with cache, retries and fallbacks; alerts feed; My Stations |
| D | Kiro steering, specs and hooks, the MCP server, demo mode, video and write-up |

## MBTA API

### The short version
The MBTA V3 API has 27 endpoints, but **we only call 3 live**:

| Live endpoint | What it gives us | Server cache |
|---|---|---|
| `/alerts` | Broken elevators and escalators, shuttles, closures | 30 s |
| `/vehicles` | Train positions for the live map | 10–15 s |
| `/predictions` | Next trains at a station | 15–20 s |

Everything else comes from the GTFS file (`cdn.mbta.com/MBTA_GTFS.zip`, 22 MB), loaded at build time: stations, the elevator and stair paths inside stations, routes, colors and line shapes. That's zero API calls.

### Traps that would cost hours
- **Elevator alerts disappear** unless every `/alerts` call includes `filter[activity]=ALL`.
- **No endpoint shows "elevator up or down."** Outages only show up as alerts. `/live_facilities` is parking only.
- **Elevator IDs match across alerts, `/facilities` and GTFS** (237 of 237), so the reroute idea works.
- **Trains, predictions and alerts use platform IDs**, not station IDs. Map each platform to its parent station.
- **Predictions include past and cancelled trains**, and their "status" and "headsign" fields come back empty, so we filter and compute those ourselves.
- **The Silver Line is filed as a bus route**, so a subway-only filter drops it.

## Resilience

- **Rate limit:** 20 requests a minute without a key, shared per IP (the venue wifi). It went from 19 to 0 in under 30 seconds in testing. A free key gives 1,000 a minute.
- **All MBTA calls go through our server and get cached**, so the number of users doesn't matter: about 6 upstream calls a minute, plus 3 per station someone is viewing.
- **Fallback chain:** MBTA API (key + cache) → MBTA's CDN realtime files (same data, no key) → last good data → demo snapshot saved in the repo. The app shows a "data may be stale" badge when it isn't on the first source.
- **Retry rules:** server errors and timeouts retry twice with growing waits. On 429, wait until the reset time and switch to the CDN. Never retry 400, 403 or 404. After 3 failures in a row, pause for 60 seconds.
- **"Nothing changed" (304) responses don't count against the limit**, so send `If-Modified-Since`.

## Crash data

- **Crash data is history, not live.** We ship a precomputed layer plus our own tested predictions, so nothing on this layer can fail at runtime.
- **Predicting where crashes happen works, modestly.** Trained on 2015–2023 and tested on 2024–2026, the top 5% of city blocks by past pedestrian and bike crashes caught **27% of future ones**, 5–6 times better than random. A perfect ranking would only catch about 32–36%.
- **The simplest method won.** A plain count beat every fancier smoothing method, so we don't call it AI. Our line: "We tested it on 2024–26 data."
- **When crashes happen is very stable** (0.96 correlation between periods). Pedestrian crashes peak 3–7 PM, highest on Fridays. Bike crashes peak at 8 AM and 5–6 PM, and July has about 5 times January's crashes.
- **Top hotspot:** Mass Ave at Melnea Cass, #1 in both the training years and the test years.
- **In the app:** blocks colored as top 1%, 5% and 10%; "You pass 2 high-crash intersections" on routes, weighted by the current hour; a "How we know" panel; a "Historical, not live" label.

## For AI agents

Paste the full brief into your AI agent before it writes code. Use the buttons below. The same content lives in the repo as `docs/lastmile-plan.md` and `docs/mbta-v3-reference.md`.

**Rules for agents working on LastMile**
1. Facts marked **(live)** were verified against the real APIs on 2026-10-24. Anything marked **UNVERIFIED** must be checked before you rely on it. Don't invent endpoints, fields or datasets.
2. Never call the MBTA API from the browser. All calls go through our server routes with caching, retries and the fallback chain.
3. Every `/alerts` call includes `filter[activity]=ALL`.
4. API keys only in environment variables. Never in client code or the public repo.
5. Scope is the subway: Red, Orange, Blue, Green-B/C/D/E, Mattapan.
6. Static data (stations, paths, elevators, routes, shapes) comes from GTFS at build time, not the live API.
7. Crash data is historical. Call it "recorded crashes" and show the backtest, never "AI risk."
8. The router must never use a closed elevator. Write a property-based test for it.
9. Walking routes come from the public Valhalla server (`valhalla1.openstreetmap.de`, no key; OpenRouteService signups are down). It's a shared service: cache every route on our server, pre-compute demo routes, and fall back to OSRM foot routing, then a straight line.
10. Next.js App Router only. Secrets stay in route handlers and `src/lib/server/` files marked `import 'server-only'`; never use `NEXT_PUBLIC_` for keys. The map component is `'use client'` and loaded with `next/dynamic` and `ssr: false`.
11. Parking data has no live occupancy. Show capacity, accessible spaces, fees and parking alerts, never "spots available now."
