# LastMile: Team Brief

Hackachusetts · Saturday, Oct 24, 2026 · Civic Action track (V3: safer, connected places) · Built in Kiro

## Overview

**LastMile** is a mobile-friendly web app for people who can't use stairs. It shows which MBTA elevators, ramps and lifts are broken right now, plans step-free trips that reroute around closures, tells you which station door to use, and warns about hazards on the walk: poor curb ramps, open sidewalk problems and places with recorded pedestrian and bike crashes. The app itself is built to be accessible: everything the map does is also available as a text list.

**Who it's for:** wheelchair users, parents with strollers, people with canes, injuries or heavy luggage, and older riders. Today they often find out about a broken elevator only when they reach the platform. About 12% of Boston residents report a disability (City of Boston report on 2017-2021 ACS data: 78,635 of 667,612).

**What is different from the MBTA's own alerts page and from Google or Apple Maps:** those tell you an elevator is out. LastMile also tells you the street-level story: which door is step-free, what the walk between exits looks like (ramp condition, open sidewalk cases), and it lets you save stations and get alerted. We found no consumer tool that combines these for Boston.

**Why it can win**
- A clear user and a clear equity story (judging: potential value).
- Live public data plus a 20-second demo moment: pick a station, press **"break this elevator"**, watch the route recalculate, see which door to use and the ramp and crash warnings on the walk.
- Real Kiro work (judging: implementation): an MBTA MCP server, specs, property-based tests ("never route through a closed elevator"), steering docs and hooks, including an accessibility checker hook.

**Stack:** TypeScript, Next.js as a PWA, MapLibre map with OpenFreeMap tiles (no key), a shared server-side cache in front of every MBTA call (Next.js `fetch` revalidation, or a KV store; see Resilience), built in Kiro.

### Before 11:30 (if you are past this, do it now)
- [ ] Get the free **MBTA V3 API key** at api-v3.mbta.com. Without it the whole venue shares 20 requests a minute.
- [ ] Nothing to sign up for walking routes. OpenRouteService signups are down, so we use the free public **Valhalla** server (`valhalla1.openstreetmap.de`, no key), which has a wheelchair mode. Checked again today: a wheelchair route returned in about 0.5 s.
- [ ] Optional: an **LLM key** (Bedrock or similar). It's only used for plain-language alerts. Kiro credits don't pay for your app's LLM calls.
- [ ] Create the **public GitHub repo**. Keep `/.kiro` at the root and **not** in `.gitignore`; keep `.env.local` gitignored.
- [ ] Agree on scope and who builds what (see Build plan).
- [ ] Ask one wheelchair user, or the campus disability services office, for ten minutes of feedback before 5 PM. Use one quote in the video.

### Corrections from live checks
These were checked against the real APIs on Oct 24. Earlier versions of the plan got them wrong.
1. **There's no curb-ramp category in Boston 311**, but Boston publishes a **Pedestrian Ramp Inventory** (24,022 ramps) and a **Sidewalk Inventory** (24,727 segments). Those are the street-level accessibility data. See Features and the reference doc, section 8.
2. **Crash data isn't live.** The latest Vision Zero record is from **Sept 1, 2026**. The crash layer shows recorded history. The live parts are MBTA (seconds old) and 311 (through Oct 22).
3. **Boston's crash data has no severity, speed limit, road type or victim type**, so the severity and speed-limit charts in the organizers' SafeStreets mockup can't honestly be built for Boston, and nothing in it is specific to disabled people. We have mode (car, pedestrian, bike), time, location, and a separate 162-record fatalities dataset.
4. **MBTA live streaming (SSE) needs an API key.** It returned 406 without one. We poll with a shared server-side cache instead.
5. **Count facilities with paging.** A single `/facilities` request capped at 1,000 rows gives wrong totals. Paged totals: 237 elevators, 183 escalators, 58 ramps, 56 portable boarding lifts, 169 parking areas.
6. **Step-free is more than elevators.** Ramps, portable boarding lifts and `ACCESS_ISSUE` alerts (for example a mini-high platform out of service) also decide whether a stop is usable.
7. **Boston 311 has more than one table.** The "311 Service Requests - 2026" table holds 190,577 cases from Jan 1 to Oct 22, 2026. A separate "NEW SYSTEM" table also exists (SQL against it returned an error). Check both before trusting any count.

### Key numbers (pull these live; do not hard-code them in the pitch)
| What | Count (Oct 24, late morning) |
|---|---|
| MBTA alerts right now | about 140 (about 15 elevator, 20 escalator closures) |
| Elevators in the system | 237 (IDs match across alerts, `/facilities` and GTFS) |
| Other facilities | 183 escalators, 58 ramps, 56 portable boarding lifts, 169 parking areas (149 list accessible spaces) |
| In-station paths in GTFS | 9,325 (490 elevator rows) |
| Vision Zero crashes | 44,986 (2015 to Sept 2026): 33,915 car, 6,999 pedestrian, 4,072 bike |
| Boston curb ramps | 24,022 in the inventory; about 2,160 rated poor, about 2,950 unknown |
| Boston 311 cases in the 2026 table | 190,577 (Jan 1 to Oct 22) |

## Features & data

Every source below was called live unless marked otherwise. "Free key" means sign up and get it instantly.

### Must (the product does not work without these)

| # | Feature | Data source | Check |
|---|---|---|---|
| M1 | **Stations by step-free status**, shown with an icon and a text label, never color alone | GTFS `stops.txt` / MBTA `/stops` (`wheelchair_boarding`) | ✅ 101 accessible, 24 inaccessible subway stations |
| M2 | **"What's broken now" feed**, with a toggle for escalators (they matter for cane and luggage users but not for wheelchair routing) | MBTA `/alerts` (always `filter[activity]=ALL`) | ✅ |
| M3 | **Know which elevator your route uses** | GTFS `pathways.txt` + `facilities.txt` | ✅ 185 of 188 subway elevators have path records; IDs match alerts |
| M4 | **Step-free trip planner and reroute**: elevators, ramps, portable lifts and `ACCESS_ISSUE` alerts all count | Station graph from GTFS route patterns, minus closed facilities | Built by us from verified data |
| M5 | **"Break this elevator" demo control**, plus a list of stations with no step-free path right now | Our own switch on top of M4 | Built by us |
| M6 | **Wheelchair walking directions** | Valhalla public server, `costing: pedestrian` with `type: wheelchair`, `max_grade`, `step_penalty`. Fallback: OSRM foot, then a straight line | ✅ |
| M7 | **Crash history layer**, pedestrian and bike by default, with a "recorded crashes, historical, not live" label | Vision Zero crash records (data.boston.gov) | ✅ |
| M8 | **Hazards on your walk** | Boston 311 open cases: Sidewalk Repair, Illegally Blocked Sidewalk, Street Light Outage, and in winter Unshoveled Sidewalk | ✅ lat/long present; confirm which 311 table is current |
| M9 | **My stations**: in-app alert when one breaks | MBTA `/alerts`, cached 30 s | ✅ |
| M10 | **Accessible by design**: a text list view that does everything the map does, keyboard use, labelled controls, an aria-live region for alerts, no color-only meaning, large touch targets, reduced motion, and a checker hook (axe-core) | Our own work | Required |
| M11 | **Base map** | OpenFreeMap tiles (no key) | ✅ |

### Should (build after the Musts work, in this order)

| # | Feature | Data source | Check |
|---|---|---|---|
| S1 | **Curb ramp layer and "poor or lipped ramps near your route"** | Boston Pedestrian Ramp Inventory (GeoJSON or CSV with `shape_wkt`) | ✅ 24,022 rows; fields `COND`, `LIP`, `ACCESS_`, `APRON_SL`, `LANDING_SL`, `RCI`, `AAB_COMP`. Confirm slope units and what `AAB_COMP` means in the data dictionary before using it on screen |
| S2 | **Station page**: which door is step-free, the list of elevators, each elevator's `alternate-service-text` | GTFS entrances (`door-*` stops carry their own `wheelchair_boarding`) and `/facilities` properties | ✅ |
| S3 | **Accessible parking at stations** | MBTA `/facilities?filter[type]=PARKING_AREA`, property `capacity-accessible` | ✅ 149 of 169 areas list it. Limit to subway-served lots |
| S4 | **Next trains at a station** | MBTA `/predictions` | ✅ Needs cleanup (drop past and cancelled rows) |
| S5 | **Plain-language alert text** | Our LLM key | Optional |
| S6 | **Live train map** | MBTA `/vehicles` | ✅ 79 trains. Decoration for this audience, so it is last |

### Not building today
Fatal crash markers, resident-reported danger spots, weather on the walk, Bluebikes, the equity view, translation, a crash "prediction" model. Mention them as future work, nothing more.

**Scope:** subway only (Red, Orange, Blue, Green B/C/D/E, Mattapan). The Silver Line is filed as a bus route in the API, so it's out. Commuter rail and buses are out.

## Risks

| Risk | What could go wrong | Fix |
|---|---|---|
| **Scope** | A "full-fledged app" in about 8 hours is the number one way to lose. We estimate about 30 person-hours of work against about 24 available before the freeze. | Feature freeze at **5:30 PM**. Subway only. Build in the order of the cut line below and stop when time says so. |
| **Trip planner** | A real timetable router is too hard for one day. It is also the critical path. | Station-to-station shortest path on about 125 stations plus a walk to the nearest step-free station. Label travel times as approximate. **Gate at 3:00 PM:** if the Park Street reroute doesn't work, fall back to the station-level answer ("not step-free right now; nearest step-free station is X; MBTA says Y") plus the walking leg. |
| **Elevator matching** | Alert IDs might not line up with station paths. | Already checked: 185 of 188 subway elevators match. Still test the join first. Each elevator appears as two one-way rows, so close both. |
| **Step-free edge cases** | Surface stops depend on ramps and lifts, not elevators. | Count RAMP, PORTABLE_BOARDING_LIFT and BRIDGE_PLATE facilities and treat `ACCESS_ISSUE` on a station as "check before you go". |
| **Demo luck** | No useful outage live during the demo. | The "break this elevator" switch (M5) plus a saved set of today's real alerts. |
| **Rate limit** | 20 requests a minute without a key, shared by every user and the whole venue wifi. | Get the free key (1,000 a minute). Proxy and cache every call on the server. |
| **Serverless cache** | A module-level `Map` cache is per function instance on serverless hosting, so it does not coalesce calls across instances. | Use Next.js `fetch(url, { next: { revalidate: 30 } })` or a KV store, or host on one long-lived server. |
| **Silent alert loss** | Elevator alerts disappear unless `filter[activity]=ALL` is sent. | Always send it. Add a test for it. |
| **Leaked keys** | The rules require a public repo. | Keys only in env vars. `.env.local` gitignored, `.kiro` not. A Kiro hook blocks commits containing keys. |
| **Misleading crash map** | Raw counts mostly show busy streets, and the data has no victim type or severity. | Call them "recorded crashes", never "dangerous" or "predicted". Default to pedestrian and bike. Show the 27% backtest only as a footnote. |
| **Data size on phones** | 45k crashes, 190k 311 cases and 24k ramps are too much for a phone browser. | Pre-group crashes into 250 m cells and 311 into recent open cases with a build script; ship small JSON. Ramps: keep only id, point, condition, lip. |
| **Data gaps** | The ramp and sidewalk inventories can be incomplete or old. | Show "no data" separately from "no problem", with inspection dates where available. |
| **App not accessible** | A product for people with disabilities that fails keyboard or screen-reader use. | M10, an axe-core hook, and a ten-minute screen-reader pass (VoiceOver or NVDA) before the freeze. |
| **Push notifications** | iPhones only allow web push for home-screen apps, and free hosting won't run a background checker reliably. | Alerts show in the app while it's open. Optional: email, or a phone push through ntfy.sh for the demo (unverified; test first). |
| **Location** | Live location fails indoors or gets blocked. Location is also personal. | Add a "pretend I'm at Park Street" button. Keep location on the device; do not store it. |
| **LLM cost** | Kiro credits don't cover the app's LLM calls. | Bring your own key. Keep the LLM optional (alert text is already English). |
| **Walking routes** | OpenRouteService signups are down. The free Valhalla server is a shared public service meant for light use, and wheelchair data in OpenStreetMap is patchy. | Use Valhalla. Cache every route on our server, pre-compute the demo routes, and fall back to OSRM foot routing, then a straight line. Label walking legs as estimates. Use the ramp layer (S1) to cover the gaps. |
| **Everyone builds SafeStreets** | It's the organizers' sample idea, so many teams will ship a crash dashboard. | Lead with step-free live rerouting. The crash layer supports it; it isn't the product. |
| **Kiro judging** | Kiro use is scored, and too little can disqualify. | Set up steering, specs and hooks first, not at 7 PM. Use the Kiro CLI as well as the IDE, and one Kiro power. |

**Cut line, in order:** if behind, drop S6, then S5, S4, S3, S2, S1, and only then touch a Must. Never cut M4, M5, M6, M9 or M10.

## Build plan

### Repo structure
```
lastmile/
  .kiro/
    steering/   product.md, tech.md, data-sources.md, accessibility-language.md, a11y.md
    specs/      router/ alerts/ crash-map/ accessible-ui/  (requirements, design, tasks)
    hooks/      run router tests on save, run axe-core on UI save, block commits containing keys
    settings/mcp.json   → MBTA MCP server
  mcp/mbta/            MCP server: alerts, facilities, stops, vehicles
  scripts/             build-station-graph (GTFS), build-crash-grid, build-311-hazards, build-ramps
  data/generated/      stations.json, elevators.json, crash-grid.json, hazards.json, ramps.json, demo-alerts.json
  web/  (Next.js PWA)
    app/               map · list view · plan trip · alerts · station detail
    app/api/           alerts, predictions (cached, with fallbacks), route, hazards
    lib/               mbta client (cache, retries, demo fallback), router, route warnings
  tests/               property-based tests (fast-check)
  docs/                lastmile-plan.md, mbta-v3-reference.md, KIRO.md (Kiro write-up)
```

### Phases (hacking starts at 11:30)
| When | Phase | Done when |
|---|---|---|
| Now–11:30 | **Setup**: keys, repo, Kiro steering and specs (planning only; code starts at 11:30) | Keys in hand, specs written |
| 11:30–1:00 | **Spikes and data**: A: GTFS station graph and elevator closure join. B: map shell, stations with icons, list view. C: cached MBTA layer, alerts feed, demo snapshot, break-elevator switch. D: finish steering, specs, hooks, MCP skeleton, then data scripts | Elevator join confirmed; alerts feed on screen |
| 1:00–3:00 | **Status and layers**: step-free stations, broken-now feed, station page, crash, hazard and ramp layers | Usable on a phone |
| **3:00** | **Gate**: does the Park Street reroute work? | Yes, or switch to the fallback in Risks |
| 3:00–4:30 | **Trip planner UI**: reroute, wheelchair walking leg, route warnings (ramps, hazards, crashes) | Park Street reroute works end to end |
| 4:30–5:30 | **Polish**: My Stations, accessibility pass (axe, keyboard, screen reader), demo mode, mobile and PWA | **Feature freeze 5:30** |
| 5:30–6:30 | **Ship**: deploy, README, KIRO.md, test link. Record the video around 6:15 | Live URL works; video recorded |
| 6:30–7:30 | **Submit**: upload the video to YouTube, submit on SundAI | Submitted 30 minutes early |

Dinner is 5-6 PM; keep working through it.

### Suggested split (if 2–4 people)
| Person | Owns |
|---|---|
| A | GTFS graph, the router and its property tests |
| B | Map UI, list view, station page, accessibility, mobile layout |
| C | Server API layer: MBTA client with shared cache and demo fallback; alerts feed; My Stations; break-elevator switch |
| D | Kiro steering, specs and hooks, the MCP server, then data scripts (crash grid, 311, ramps); demo mode, video and write-up |

## MBTA API

### The short version
The MBTA V3 API has 27 endpoints, but **we only call 1 or 2 live**:

| Live endpoint | What it gives us | Server cache |
|---|---|---|
| `/alerts` | Broken elevators, escalators, access issues, shuttles, closures | 30 s |
| `/predictions` | Next trains at a station (Should) | 15–20 s |
| `/vehicles` | Train positions for the live map (last priority) | 10–15 s |

Everything else comes from the GTFS file (`cdn.mbta.com/MBTA_GTFS.zip`, 22 MB), loaded at build time: stations, the elevator and stair paths inside stations, routes, colors and line shapes. That's zero API calls.

### Traps that would cost hours
- **Elevator alerts disappear** unless every `/alerts` call includes `filter[activity]=ALL`.
- **No endpoint shows "elevator up or down."** Outages only show up as alerts. `/live_facilities` is parking only.
- **Elevator IDs match across alerts, `/facilities` and GTFS** (237 of 237), so the reroute idea works.
- **Page through `/facilities`.** One big request can silently cut off at 1,000 rows.
- **Trains, predictions and alerts use platform IDs**, not station IDs. Map each platform to its parent station.
- **Predictions include past and cancelled trains**, and their "status" and "headsign" fields come back empty, so we filter and compute those ourselves.
- **The Silver Line is filed as a bus route**, so a subway-only filter drops it.

## Resilience

- **Rate limit:** 20 requests a minute without a key, shared per IP (the venue wifi). It went from 19 to 0 in under 30 seconds in testing. A free key gives 1,000 a minute.
- **All MBTA calls go through our server and get cached.** Use a cache that is shared across server instances (Next.js `fetch` revalidation, or a KV store), or host on one long-lived server. With the key, the budget is comfortable either way: about 2 upstream calls a minute for alerts, plus 3 per station someone is viewing.
- **Fallback chain (keep it short):** MBTA API (key + cache) → last good data → demo snapshot saved in the repo. The app shows a "data may be stale" badge when it isn't on the first source. The MBTA CDN realtime files and a circuit breaker are optional extras; skip them unless everything else is done.
- **Retry rules:** server errors and timeouts retry twice with growing waits. On 429, wait until the reset time and serve the last good data. Never retry 400, 403 or 404.
- **"Nothing changed" (304) responses don't count against the limit**, so send `If-Modified-Since`.

## Crash history

- **Crash data is history, not live.** We ship a precomputed layer, so nothing on this layer can fail at runtime. It is not a prediction model.
- **Where crashes happened, ranked by past counts, is a useful guide.** Trained on 2015–2023 and tested on 2024–2026, the top 5% of 250 m cells by past pedestrian and bike crashes held **27% of the later ones**, 5–6 times better than random. Show this as one footnote, nothing more.
- **The simplest method won.** A plain count beat every fancier smoothing method, so we don't call it AI.
- **Time patterns** are stable, so a plain note is enough: pedestrian crashes cluster on weekday late afternoons, bike crashes at commute hours and in summer. Do not scale route warnings by the current hour.
- **Top hotspot:** the Mass Ave and Melnea Cass / Gerard Street area. Check each cell label by eye before it appears in the video.
- **In the app:** areas colored as top 1%, 5% and 10% (with a label and icon, not color alone); "Your walk passes through 2 high-crash areas" (cells are 250 m, not intersections); a "Historical, not live" label; and these limits stated: only crashes with a 911 dispatch, no severity, no victim type, no exposure data.

## Submission checklist (from the rules)

- [ ] Public GitHub repo with all code and instructions; `/.kiro` at the root and **not** in `.gitignore`
- [ ] Text description of features and functionality
- [ ] Demo video under 3 minutes, publicly visible on YouTube, Vimeo, Facebook Video or Youku, no copyrighted music
- [ ] Track named: Civic Action
- [ ] `docs/KIRO.md` that answers: which Kiro tools (IDE, CLI, Web, Crew), spec-driven vs vibe coding, hooks, steering, MCP, property-based tests, powers
- [ ] At most 4 team members, all added to the submission
- [ ] Deadline 8:00 PM

## Honest framing (put this on screen)

- "Not official MBTA information. Confirm before you travel."
- Attribution for OpenStreetMap, OpenFreeMap, Valhalla and MBTA data (check the MBTA developer license terms).
- Location stays on the device.
- We have not tested with riders yet beyond the feedback session; say what that feedback was.

## For AI agents

Paste the full brief into your AI agent before it writes code. The same content lives in the repo as `docs/lastmile-plan.md` and `docs/mbta-v3-reference.md`.

**Rules for agents working on LastMile**
1. Facts marked **(live)** were verified against the real APIs on 2026-10-24. Anything marked **UNVERIFIED** must be checked before you rely on it. Don't invent endpoints, fields or datasets.
2. Never call the MBTA API from the browser. All calls go through our server routes with a shared cache and the fallback chain.
3. Every `/alerts` call includes `filter[activity]=ALL`.
4. API keys only in environment variables. Never in client code or the public repo.
5. Scope is the subway: Red, Orange, Blue, Green-B/C/D/E, Mattapan.
6. Static data (stations, paths, elevators, routes, shapes) comes from GTFS at build time, not the live API.
7. Crash data is historical. Call it "recorded crashes". Never call it a prediction, "risk" or "AI".
8. The router must never use a closed elevator, ramp or lift. Write a property-based test for it.
9. Walking routes come from the public Valhalla server (`valhalla1.openstreetmap.de`, no key). It's a shared service: cache every route on our server, pre-compute demo routes, and fall back to OSRM foot routing, then a straight line.
10. Every screen must work without the map. Every status needs an icon or text, never color alone. Run the accessibility checker before you say a UI task is done.
11. Never say a route or place is "safe". Say what the data shows and when it was recorded.
12. Do not build anything in "Not building today".
