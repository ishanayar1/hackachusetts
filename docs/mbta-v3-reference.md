# LastMile: MBTA V3 + Data Reference

This doc is for the hackathon team and for use as a Kiro steering doc. Facts marked **(live)** were checked against `api-v3.mbta.com` on 2026-10-24. **(docs)** means it came from the swagger file or the MBTA docs. **UNVERIFIED** means it was not confirmed, so check it before you rely on it. **(design)** means it is our own recommendation, not an MBTA fact.

Base URL: `https://api-v3.mbta.com`. Every endpoint is GET only and returns JSON:API (`application/vnd.api+json`).

---

## 1. The 60-second version

**Rules**
- Every MBTA call goes through our Next.js route handlers (`src/app/api/*/route.ts`). Browsers never call MBTA directly.
- Put the API key in the server env var `MBTA_API_KEY` and send it as the `x-api-key` header.
- Without a key, the limit is 20 requests/min per IP, shared by the whole hackathon wifi. A free key gives 1,000/min **(docs)**.
- Anything static (stations, elevators, pathways, routes, shapes) comes from GTFS static at build time. The live API is only for alerts, vehicles and predictions.

**The 6 endpoints we actually need**

| # | Endpoint | Why |
|---|---|---|
| 1 | `/alerts` | Broken elevators and escalators, shuttles, suspensions, closures |
| 2 | `/vehicles` | Live train map |
| 3 | `/predictions` | "Next 3 trains" |
| 4 | `/facilities` | Elevator names and ids, to join with alerts (or use GTFS `facilities.txt`) |
| 5 | `/stops` | Station list, step-free flags, entrances (or use GTFS `stops.txt`) |
| 6 | `/route_patterns` + `/shapes` / `/routes` | Station graph, line geometry, colors (build time only) |

**Calls per screen (all server-side and cached)**

| Screen | Upstream call(s) | Server TTL |
|---|---|---|
| Live map | `GET /vehicles?filter[route]=Red,Orange,Blue,Green-B,Green-C,Green-D,Green-E,Mattapan&include=trip&fields[trip]=headsign,wheelchair_accessible,direction_id` | 10-15 s |
| What's broken feed | `GET /alerts?filter[route_type]=0,1&filter[activity]=ALL&include=facilities,stops&sort=-severity` | 30 s |
| Step-free router | Same alerts snapshot (read the closed elevator facility ids from it) plus the bundled GTFS pathways graph | 30 s |
| Station detail / next trains | `GET /predictions?filter[stop]=place-XXX&include=trip&fields[trip]=headsign&sort=departure_time` | 15-20 s |
| My stations | The same predictions call with `filter[stop]=place-A,place-B,...` (1 call) | 15-20 s |
| Crash risk layer | No API call. It reads a static precomputed JSON. | build time |

---

## 2. Endpoint cheat sheet (all 27 paths)

| Group | Path(s) | Purpose | Key params | LastMile use |
|---|---|---|---|---|
| **Alerts** | `/alerts` | Service and facility alerts | `filter[activity]` (**always send it**), `filter[route_type]`, `filter[route]`, `filter[stop]`, `filter[facility]`, `filter[datetime]=NOW`, `filter[lifecycle]`, `filter[severity]`, `filter[id]`, `filter[banner]`, `filter[direction_id]` (needs route), `filter[trip]`, `include=stops,routes,trips,facilities`, `fields[alert]`, `sort` | **USE**: feed and router |
| | `/alerts/{id}` | One alert | `include`, `fields[alert]` (no filters) | Mostly skip. Read from the cached list, or batch with `filter[id]=a,b,c` |
| **Access** | `/facilities` | Static elevators, escalators, parking, bike storage (**no live status**) | `filter[type]`, `filter[stop]`, `include=stop`, `fields[facility]`, `page[limit]` | **USE** once (24 h) or use GTFS instead |
| | `/facilities/{id}` | One facility | `include=stop` | Skip. Use only on a cache miss |
| | `/live_facilities` | Live parking data only | `filter[id]` **required** | Skip. It returned empty rows (live) |
| | `/live_facilities/{id}` | One live facility | id | Skip. 404 for `park-ogmnl` (live) |
| | `/stops` | Platforms, stations, entrances, nodes | `filter[route_type]`, `filter[location_type]`, `filter[route]`, `filter[latitude/longitude/radius]` (radius in **degrees**), `sort=distance`, `include=child_stops,connecting_stops,facilities,parent_station,route` | **USE** once (24 h) or use GTFS |
| | `/stops/{id}` | One station with its full hierarchy | `include=child_stops,connecting_stops,facilities,parent_station` | Optional station detail (133 KB). Prefer GTFS |
| **Live** | `/vehicles` | Live train positions | `filter[route]`, `filter[route_type]`, `filter[direction_id]` (needs route), `filter[revenue]`, `include=trip,stop,route`, `fields[...]` | **USE**: live map |
| | `/vehicles/{id}` | One vehicle | id | Skip |
| | `/predictions` | Realtime arrivals and departures | A filter is **required**: `filter[stop]`, `filter[route]`, `filter[trip]`, lat/lon/radius, `filter[direction_id]`, `filter[route_type]` (only with another filter), `filter[schedule_relationship]`, `filter[route_pattern]`, `include=schedule,stop,route,trip,vehicle,alerts`, `sort=departure_time` | **USE**: next trains |
| | `/stop_events` | Observed arrival and departure times (ground truth) | Filter required: `filter[stop|trip|route|vehicle]`, `sort=-arrived`, `include` | Optional: "line looks stalled" and our own delay model |
| | `/stop_events/{id}` | One event | id | Skip |
| | `/schedules` | Timetable times | `filter[route|stop|trip]` required, `filter[date]`, `filter[min_time]`/`filter[max_time]` (HH:MM, can be >24:00), `filter[stop_sequence]=first,last` | Fallback for "next trains" (labelled *scheduled*), first and last trains |
| | `/trips` | Trip metadata | `filter[id|route|route_pattern|name]` required, `filter[date]`, `include=shape,route_pattern,...` | Skip. Use `include=trip` on vehicles and predictions |
| | `/trips/{id}` | One trip | `include=shape,route_pattern` | Skip |
| **Network** | `/routes` | Route ids, colors, direction labels | `filter[type]`, `filter[id]`, `filter[stop]`, `filter[listed_route]`, `include=line,route_patterns`, `fields[route]` | Build time (24 h) |
| | `/routes/{id}` | One route | id | Skip |
| | `/route_patterns` | Ordered stop lists per branch and direction | `filter[route]`, `filter[canonical]=true`, `filter[direction_id]`, `include=representative_trip.stops` | Build time. Optional runtime shuttle detection (typicality 4, 1 h TTL) |
| | `/route_patterns/{id}` | One pattern | id | Skip |
| | `/lines` | Groups routes into lines (Green = B/C/D/E) | `filter[id]` (always), `include=routes` | Build time only (all lines is about 266 KB) |
| | `/lines/{id}` | One line | id | Skip |
| | `/shapes` | Route geometry (encoded polyline) | `filter[route]` **required** | Build time. Use `canonical-*` ids |
| | `/shapes/{id}` | One shape | id | Skip |
| | `/services` | Service calendars | `filter[route]`, `filter[id]` | Skip for the MVP. `schedule_typicality=4` = planned disruption |
| | `/services/{id}` | One service | id | Skip |
| | `/transfers` | Trip-scoped transfer rules | `filter[from_trip]` **required** | Skip. Returned `[]` for a subway trip (live) |

**JSON:API mechanics (live):**
- `include=a,b.c` nests to any depth.
- `fields[type]=x,y` also works for included types, e.g. `fields[trip]=headsign`.
- `sort=attr` or `sort=-attr`. An invalid sort key returns 400 `Invalid sort key.`
- `page[limit]` and `page[offset]` paginate. `links{first,next,last}` appears only when paginated.
- Join `included[]` items by `(type, id)`.
- In curl, URL-encode `[]` or use `curl -g`.

---

## 3. Details for the endpoints we use

### 3.1 `/alerts`

**Recommended queries (live)**

| Need | Query | Result on 2026-10-24 |
|---|---|---|
| Subway accessibility alerts right now | `/alerts?filter[route_type]=0,1&filter[activity]=USING_WHEELCHAIR,USING_ESCALATOR&filter[datetime]=NOW&include=facilities,stops` | Without datetime: 28 (ESCALATOR_CLOSURE 17, ELEVATOR_CLOSURE 10, ACCESS_ISSUE 1). Every informed_entity had a `facility` key. |
| Full subway feed right now | `/alerts?filter[route_type]=0,1&filter[activity]=ALL&filter[datetime]=NOW&include=facilities,routes` | 39 (ESC 17, ELEV 10, STATION_CLOSURE 4, STATION_ISSUE 3, NOTICE 3, ACCESS_ISSUE 1, DELAY 1) |
| Feed including "coming soon" | Same query **without** `filter[datetime]`, then check `active_period` yourself | Includes UPCOMING |
| Major disruptions only | `/alerts?filter[severity]=7,8&filter[lifecycle]=NEW,ONGOING&filter[route_type]=0,1` | 4 STATION_CLOSURE |
| One station | `/alerts?filter[stop]=place-dwnxg&filter[activity]=ALL` | 2 (an ELEVATOR_CLOSURE and a NOTICE) |
| One elevator | `/alerts?filter[facility]=869&filter[activity]=ALL` | 1. **Without `activity=ALL` it returns 0.** |
| Smaller payload | Add `fields[alert]=effect,header,severity,informed_entity,lifecycle` | The full unfiltered list is about 400 KB |

Silver Line is optional. Its routes are type 3 (bus), so add `filter[route]=741,742,743,746,749,751` to include them.

**Activities enum:** `BOARD, EXIT, RIDE, USING_WHEELCHAIR, USING_ESCALATOR, PARK_CAR, BRINGING_BIKE, STORE_BIKE, ALL`.

> **Trap #1:** the docs say a missing `filter[activity]` defaults to `BOARD,EXIT,RIDE`. Live, that default was skipped only when **no** query params were sent (139 results, the same as ALL). As soon as any other filter was present, elevator alerts disappeared, because elevator alerts carry only `USING_WHEELCHAIR` or `USING_ESCALATOR`. **Always pass `filter[activity]` explicitly.**

**Lifecycle:** `NEW, ONGOING, UPCOMING, ONGOING_UPCOMING`. The last one is documented but was not seen live. `filter[datetime]=NOW` removes UPCOMING alerts.

**Severity:** an integer from 0 (least) to 10 (most) **(docs)**. Seen live: 1, 3, 4, 5, 6, 7, 8. Elevator and escalator alerts are 1 or 3. Closures and suspensions are 7-8. On 2026-10-24 the full list of 139 had these counts: 1:31, 3:40, 4:2, 5:6, 6:2, 7:50, 8:8.

**Effect enum (docs):** ACCESS_ISSUE, ADDITIONAL_SERVICE, AMBER_ALERT, BIKE_ISSUE, CANCELLATION, DELAY, DETOUR, DOCK_CLOSURE, DOCK_ISSUE, ELEVATOR_CLOSURE, ESCALATOR_CLOSURE, EXTRA_SERVICE, FACILITY_ISSUE, MODIFIED_SERVICE, NOTICE, NO_SERVICE, OTHER_EFFECT, PARKING_CLOSURE, PARKING_ISSUE, POLICY_CHANGE, SCHEDULE_CHANGE, SERVICE_CHANGE, SHUTTLE, SNOW_ROUTE, STATION_CLOSURE, STATION_ISSUE, STOP_CLOSURE, STOP_MOVE, STOP_MOVED, SUMMARY, SUSPENSION, TRACK_CHANGE, UNKNOWN_EFFECT.
- Seen live across all 139 alerts: DETOUR 28, ESCALATOR_CLOSURE 20, ELEVATOR_CLOSURE 15, DELAY 11, STATION_ISSUE 10, NOTICE 10, STOP_MOVE 9, SCHEDULE_CHANGE 6, SUSPENSION 6, STATION_CLOSURE 5, PARKING_ISSUE 5, SHUTTLE 4, SERVICE_CHANGE 4, TRACK_CHANGE 3, ACCESS_ISSUE 2, STOP_CLOSURE 1.

**Alert attributes:**
- **Main fields:** `header`, `short_header` (can be `''`), `service_effect` (short, e.g. "Downtown Crossing elevator unavailable"), `description` (`\r\n` line breaks, often includes the alternate route), `effect`, `cause` (52-value enum), `severity`, `lifecycle`.
- **Timing:** `active_period[{start,end|null}]`, `timeframe` ("through December 1"), `duration_certainty` (UNKNOWN/KNOWN/ESTIMATED), `created_at`, `updated_at`, `closed_timestamp`.
- **Display:** `banner` (0 of 139 had one), `url`, `image`, `image_alternative_text`, `informed_entity[]`.
- `effect_name` is in the spec but was missing from live responses.

**informed_entity:** each row has the keys `stop, route, route_type, direction_id, trip, facility, activities[]`. A row means the **intersection** of its fields, not the union **(docs)**. Rows repeat per route and per stop, so **dedupe by alert id**.

**From an elevator alert to a station and its pathways (live, using alert 1031518):**
```
alert.effect == "ELEVATOR_CLOSURE"
  informed_entity[].facility = "869"   (same id as the elevator number in the header,
                                        as /facilities id, and as GTFS facility_id)
  informed_entity[].stop     = place-dwnxg (parent), 70078 (platform), door-dwnxg-* (entrances)
  activities                 = [USING_WHEELCHAIR]
```
1. `closedElevatorIds` = facility ids from alerts where effect is `ELEVATOR_CLOSURE` and the alert is active now (lifecycle not UPCOMING, or `active_period` covers now).
2. Station = the `place-*` stop in `informed_entity`. Mark that station "not step-free right now".
3. Router: remove GTFS `pathways.txt` rows with `pathway_mode=5` and `facility_id` in `closedElevatorIds`. Elevators are directed (`is_bidirectional=0`), so **each one appears as two rows. Remove both.**
4. The included facility's `properties[]` has `alternate-service-text`, which can be shown as a reroute hint, and `excludes-stop`, which lists platforms the elevator does **not** serve.

**Other alert behavior:**
- `/alerts/{id}` returns the same shape as a list item. A bogus id returns 404 `not_found`. Whether a *closed* alert also returns 404 is **UNVERIFIED**. Treat a 404 as "resolved".
- The `relationships` object contains only the types you asked for in `include`.

### 3.2 `/facilities` and `/stops`

**Facilities**
- `/facilities` is static and has **no up/down status**. Live outages come only from alerts.
- Type enum (API, UPPER_SNAKE): BIKE_STORAGE, BRIDGE_PLATE, ELECTRIC_CAR_CHARGERS, ELEVATED_SUBPLATFORM, ELEVATOR, ESCALATOR, FARE_MEDIA_ASSISTANCE_FACILITY, FARE_MEDIA_ASSISTANT, FARE_VENDING_MACHINE, FARE_VENDING_RETAILER, FULLY_ELEVATED_PLATFORM, OTHER, PARKING_AREA, PICK_DROP, PORTABLE_BOARDING_LIFT, RAMP, TAXI_STAND, TICKET_WINDOW. GTFS uses lower-kebab (`elevator`, `parking-area`), so normalize.
- Startup call: `/facilities?filter[type]=ELEVATOR,ESCALATOR,PORTABLE_BOARDING_LIFT&filter[stop]=<subway parents>`. The whole system has 237 elevators (667 KB). TTL 24 h.
- Attributes:
  - `long_name`, e.g. "Lansdowne Elevator 990 (...)".
  - `short_name`.
  - `latitude`/`longitude`: null for 185 of 237 elevators, so use the parent stop's coordinates.
  - `properties[{name,value}]`.
  - `relationships.stop` is always a parent `place-*`.
- Facility ids are identical in the API and GTFS (237 of 237 elevators matched).

**Stops**
- `wheelchair_boarding`: 0 = no info, 1 = accessible, 2 = inaccessible.
- `location_type`: 0 = platform, 1 = station, 2 = entrance, 3 = generic node.
- `/stops?filter[route_type]=0,1&filter[location_type]=1` returns **`[]`** because route_type filters platforms. Fetch platforms and collect their `parent_station` ids.
- Nearest station: `filter[latitude]&filter[longitude]&filter[radius]=0.01&sort=distance`. Radius is in **degrees** (0.01 is about 0.5 mi). The results are platforms, so dedupe by parent. Better: run haversine locally over the cached station list.
- Entrances (`door-*`) carry their own `wheelchair_boarding`, so you can choose a step-free street entrance. Example: `door-dwnxg-franklinelev` is 1, `door-dwnxg-hawley` is 2.
- Subway `platform_code` is often null. Use `platform_name` (e.g. "Alewife") as the direction label.

### 3.3 `/vehicles` and `/predictions`

**Vehicles (live: 79 trains, 96 KB)**
- `current_status`: `STOPPED_AT`, `INCOMING_AT` or `IN_TRANSIT_TO`.
- `bearing` (degrees clockwise from north) was never null. `speed` (m/s) was non-null for only 23 of 79, so don't use it. `label` is the lead car number. `direction_id` is 0 or 1.
- Crowding:
  - The top-level `occupancy_status` was null for all 79.
  - Use `carriages[]` for crowding. Each car has `{label, occupancy_status, occupancy_percentage}`.
  - Per-car `occupancy_status` across 290 cars: NO_DATA_AVAILABLE 197, FEW_SEATS 46, MANY_SEATS 40, STANDING_ROOM_ONLY 7.
- `relationships.stop` is a **child platform id** (e.g. `70061`). Map it to its parent with GTFS `parent_station`.
- The attribute is `revenue` in live JSON but `revenue_status` in the swagger. Read both.
- Trip ids can be `ADDED-1585019440`, which is not in GTFS static. Get the headsign via `include=trip`.
- Update cadence: in about 64 s, 69 of 79 vehicles had a new `updated_at`. A dwelling train can have a 7-minute-old `updated_at`. Polling faster than every 10-15 s gains little.

**Predictions**
- A filter is required. Without one you get 400 `At least one filter[] is required.`
- `filter[stop]=place-*` expands to child platforms. Comma lists work.
- Client-side cleanup (required):
  - Drop rows where `departure_time` (or `arrival_time`) is before now. The API returned rows about 2.5 min in the past.
  - Drop `schedule_relationship` = `CANCELLED` or `SKIPPED`. Their times are null.
  - Take 3 rows per `direction_id`/platform.
- `schedule_relationship`: null = scheduled normally. Otherwise ADDED, CANCELLED, NO_DATA, SKIPPED or UNSCHEDULED.
- `update_type`: MID_TRIP (the train is on this trip), AT_TERMINAL (waiting at the origin), REVERSE_TRIP (the train is still finishing its previous trip).
- `arrival_uncertainty` (subway): 60 = trip underway, 120 = waiting at the terminal, 360 = still on the previous trip, least reliable. Show 360 rows as "approx."
- `status` and `trip_headsign` were **null on all 40 live rows**. Compute "Arriving/Boarding" yourself from time-to-arrival plus the vehicle's `current_status`, and take the headsign from the included trip. Whether `status` is ever filled for subway is **UNVERIFIED**.
- With `sort=departure_time`, a null CANCELLED row came first. Null ordering is **UNVERIFIED**, so filter before you slice.
- Fallbacks:
  - `/schedules?filter[stop]=...&filter[route]=...&filter[min_time]=HH:MM&sort=departure_time`, labelled **"scheduled"**. Times are rounded to the minute.
  - `TripUpdates_enhanced.json` from the CDN. Its structure is **UNVERIFIED**; it was not fetched.

**`/stop_events` (optional)**
- Gives observed `arrived` and `departed` times. The newest event was about 23 s old.
- Id format seen live: `{YYYYMMDD}-{route}-{trip}-{vehicle}-{stop_sequence}`.
- How far back history goes is **UNVERIFIED**.
- Uses: "last train left X min ago" and stalled-line detection. Poll it at most every 60 s per station.

### 3.4 `/routes`, `/route_patterns`, `/shapes`

**Route ids**
- Subway: `Red, Orange, Blue` (type 1); `Green-B, Green-C, Green-D, Green-E, Mattapan` (type 0).
- Silver Line: SL1 `741`, SL2 `742`, SL3 `743`, SLW `746`, SL5 `749`, SL4 `751`. All are **type 3 (bus)**.

**Colors** (the API returns them without `#`; every `text_color` is FFFFFF)

| Line | Color |
|---|---|
| Red / Mattapan | DA291C |
| Orange | ED8B00 |
| Green | 00843D |
| Blue | 003DA5 |
| Silver | 7C878E |

**direction_id meaning depends on the route.** Read `direction_names` and `direction_destinations`.

| Route | 0 | 1 | Destinations (0 / 1) |
|---|---|---|---|
| Red | South | North | Ashmont/Braintree / Alewife |
| Orange | South | North | Forest Hills / Oak Grove |
| Blue | West | East | Bowdoin / Wonderland |
| Green-B | West | East | Boston College / Government Center |
| Green-C | West | East | Cleveland Circle / Government Center |
| Green-D | West | East | Riverside / Union Square |
| Green-E | West | East | Heath Street / Medford/Tufts |
| Mattapan, Silver Line | Outbound | Inbound | Mattapan / Ashmont (for Mattapan) |

**Station graph:**
- Call `/route_patterns?filter[route]=Red,Orange,Blue,Green-B,Green-C,Green-D,Green-E,Mattapan&filter[canonical]=true&include=representative_trip.stops`.
- It returns 18 canonical patterns (Red 4, the others 2 each), each with an ordered list of platform ids. Map each platform to its parent with `parent_station`.
- Red trunk platforms differ per branch. At JFK, Braintree-bound trips use `70096` and Ashmont-bound trips use `70086`.

**typicality:** 0 undefined, 1 typical, 2 deviation, 3 highly atypical, 4 diversion/shuttle/detour, 5 canonical. Typicality 4 patterns (e.g. `Shuttle-BackBayKenmore-0-0`) signal active shuttles.

**Shapes:**
- `filter[route]` is required.
- The only attribute is `polyline` (Google encoded, precision 5). Decode it with `@mapbox/polyline`.
- Each route has several shapes. Use the `canonical-*` ids to avoid overdraw.

**Lines:** `line-Red`, `line-Green` and `line-Mattapan` include many unlisted `Shuttle-*` route ids, so you can trace shuttle alerts and vehicles back to their line. Shuttle routes have `listed_route=false` and are hidden by default.

---

## 4. Where each piece of data comes from

| Data | GTFS static (build time) | V3 live API | CDN realtime file |
|---|---|---|---|
| Stations, platforms, entrances, nodes | **`stops.txt`** (10,292 rows) | `/stops` (refresh only) | none |
| Pathways (stairs, elevators, walkways) | **`pathways.txt`** (9,325), `levels.txt` (80) | none | none |
| Elevator and facility metadata | **`facilities.txt`** (1,881), `facilities_properties.txt` | `/facilities` (refresh only) | none |
| Routes, colors, lines | **`routes.txt`** | `/routes`, `/lines` | none |
| Stop order and branches | **`route_patterns.txt`, `trips.txt`, `stop_times.txt`** | `/route_patterns` | none |
| Line geometry | **`shapes.txt`** | `/shapes` | none |
| Elevator and escalator outages, disruptions | none | **`/alerts`** (30 s) | `Alerts_enhanced.json` |
| Train positions | none | **`/vehicles`** (10-15 s) | `VehiclePositions_enhanced.json` |
| Arrival predictions | none | **`/predictions`** (15-20 s) | `TripUpdates_enhanced.json` (structure UNVERIFIED) |
| Timetable fallback | `stop_times.txt` | `/schedules` | none |
| Crash history and risk | Precomputed static JSON from the Vision Zero CSV | none | none |

**GTFS facts (verified on `MBTA_GTFS.zip`, 22.3 MB)**

*Join integrity*
- `pathways.from_stop_id` and `to_stop_id` resolve to `stops` with 0 missing.
- `pathways.facility_id` resolves to `facilities` with 0 orphans.
- `facilities.stop_id` is a parent `place-*`.

*pathway_mode counts*

| Mode | Meaning | Rows |
|---|---|---|
| 1 | walkway | 7,492 |
| 2 | stairs | 882 |
| 4 | escalator | 187 |
| 5 | elevator | 490 (all `is_bidirectional=0`) |
| 6 | fare gate | 122 |
| 7 | exit gate | 152 |

*Routing fields*
- Elevator edge cost: use `wheelchair_traversal_time` or `traversal_time`. Elevator rows have no length; only walkways have `wheelchair_length`.
- Wheelchair routing: exclude modes 2 (stairs) and 4 (escalators).

*Coverage gaps*
- 185 of the 188 subway-station elevators have a pathway row. The exceptions are 805 and 729 (`place-brntn`) and 730 (`place-qamnl`).
- 6 mode-5 pathways have no `facility_id` (South Station bus terminal, `sstat-1856/1857/1862/1863/1866/1867`), so alerts cannot be matched to them.

*Step-free counts*
- Subway platforms: 229 accessible, 48 inaccessible.
- Subway parent stations: 101 accessible, 24 inaccessible.

**CDN files:** `https://cdn.mbta.com/realtime/{Alerts,VehiclePositions,TripUpdates}_enhanced.json` (and `.pb`).

*Access*
- No key is needed.
- 6 rapid requests got no 429 and no rate-limit headers. The CDN's published limits are UNVERIFIED.
- The CDN sends no CORS header, so fetch it **server-side only**.

*Format*
- Each file is a FULL_DATASET snapshot.
- Each file covers **all modes**, so filter to subway yourself.
- `header.timestamp` was 18 s old for vehicles and 44 s old for alerts.
- Conditional requests returned 200, not 304.

*Field mapping to V3*

| CDN field | V3 field |
|---|---|
| `stop_id` | `stop` |
| `route_id` | `route` |
| `facility_id` | `facility` |
| `alert_lifecycle` | `lifecycle` |
| `header_text.translation[0].text` | `header` |
| `active_period` (epoch seconds) | `active_period` (ISO strings) |
| `effect_detail` (V3-style, e.g. ELEVATOR_CLOSURE) | `effect` |

The CDN's own `effect` is coarse: an elevator closure shows as `ACCESSIBILITY_ISSUE`. Use `effect_detail` instead.

---

## 5. Resilience

**Rate limits (live and docs)**
- Without a key: 20 requests/min **per IP**. A shared venue NAT means everyone shares those 20. In testing, remaining went from 19 to 0 in under 30 s.
- With a key: 1,000/min **(docs)**. You can ask for more in the V3 portal. The keyed limit was not tested live.
- Headers:
  - `x-ratelimit-limit`.
  - `x-ratelimit-remaining`.
  - `x-ratelimit-reset`: UTC epoch **seconds**, observed at the next `:00` minute boundary, so it looks like a fixed 1-minute window.
- The 429 body is `{"errors":[{"code":"rate_limited","status":"429","source":{"parameter":"api_key"},...}]}`. There is **no `Retry-After`**, so compute `wait = reset*1000 - Date.now()`.
- An invalid key returns **403** `forbidden` with no rate-limit headers. It does not fall back to anonymous access.
- SSE streaming (`Accept: text/event-stream`) requires a key. Without one it returns 406.

**API key handling**
- Store it in `MBTA_API_KEY` in `.env.local` (gitignored) and in the hosting provider's env settings. **Never commit it to the public repo, and never put it in client code.** V3 allows CORS `*`, so a key in browser code is effectively public.
- Prefer the `x-api-key` header over `?api_key=` so the key stays out of URLs and logs.

**Request budget (design, arithmetic from the TTLs below)**

The server cache plus in-flight coalescing make upstream calls **independent of the number of users N**:

| Feed | TTL | Upstream calls/min |
|---|---|---|
| Vehicles | 15 s | 4 |
| Alerts | 30 s | 2 |
| Predictions | 20 s | 3 per distinct station being viewed (S) |
| **Total** | | **about 6 + 3·S per minute** |

- Without a key (20/min), that covers only about 4 distinct stations at once. Get the key.
- With a key (1,000/min), it covers more than 300 stations.
- Without the proxy, the cost becomes N × (per-client calls), and it hits 429 almost immediately.

**Server-side cache TTLs**

| Endpoint | TTL |
|---|---|
| `/vehicles` | 10-15 s |
| `/predictions` | 15-20 s |
| `/alerts` | 30 s |
| `/alerts/{id}` | 60 s |
| `/stop_events` | 60 s |
| `/route_patterns` (shuttle check) | 1 h |
| `/facilities`, `/stops`, `/routes`, `/shapes` | 24 h (or GTFS at build) |
| `/schedules` | until the next service day |
| CDN vehicles / alerts | every 10 s / every 30-60 s at most |

**If-Modified-Since:**
- V3 sends `last-modified` and `cache-control: max-age=0, private, must-revalidate`, with **no ETag**.
- Sending `If-Modified-Since` returned **304** on `/alerts` (live). A 304 has no body and no rate-limit headers, and **does not count against the limit** (docs).
- Expect 304s on alerts and static endpoints, rarely on vehicles: 64 s later the vehicles call returned 200 with changed data.
- `Last-Modified` tracks only the root type, so included data can be staler (docs).

**Retry policy (design)**

| Response | Action |
|---|---|
| 304 | Reuse the cached body |
| 429 | Do not retry immediately. Set a cooldown until `x-ratelimit-reset` + about 1 s of jitter, serve the cache and switch to the CDN. |
| 5xx or timeout (5 s AbortController) | Retry at most 2 times with exponential backoff plus jitter (about 500 ms, then about 1,500 ms), then fall back. |
| 400, 403, 404 | Do not retry. These are bugs, a bad key, or a resolved alert. |
| `x-ratelimit-remaining <= 2` | Stop calling V3 until the reset. |

**Circuit breaker (design):** after 3 consecutive failures, open the circuit for 60 s and serve fallbacks. Then let one probe through (half-open).

**Fallback chain:**
```
V3 (keyed, cached)  ->  CDN *_enhanced.json (normalized to the V3 shape)
                    ->  last-good snapshot (memory/KV, with fetchedAt)
                    ->  bundled demo snapshot (JSON in the repo, so the demo always works)
```
- Every API response to the client includes `source: "v3" | "cdn" | "cache" | "demo"` and `ageSec`.
- Show a "data may be stale" badge when the age is over 90 s.
- Show "Scheduled" whenever predictions came from `/schedules`.

**TypeScript sketch**

```ts
// lib/mbta.ts: server-only. One cache shared by all clients; no MBTA call per browser.
type Src = "v3" | "cdn" | "cache";
type Entry = { body: any; lastModified?: string; fetchedAt: number; source: Src };
const cache = new Map<string, Entry>(), inflight = new Map<string, Promise<Entry>>();
let cooldownUntil = 0, fails = 0, openUntil = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.random() * ms * 0.5;

export function getMbta(path: string, ttlMs: number, cdnFallback?: () => Promise<any>) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return Promise.resolve(hit);
  if (inflight.has(path)) return inflight.get(path)!;                // coalesce N clients -> 1 call
  const p = (async (): Promise<Entry> => {
    try { const e = await fetchWithRetry(path, hit); fails = 0; cache.set(path, e); return e; }
    catch {
      if (++fails >= 3) openUntil = Date.now() + 60_000;            // circuit breaker
      if (cdnFallback) try {
        const e: Entry = { body: await cdnFallback(), fetchedAt: Date.now(), source: "cdn" };
        cache.set(path, e); return e;
      } catch {}
      if (hit) return { ...hit, source: "cache" };                   // last-good snapshot
      throw new Error("no data");                                    // caller serves bundled demo JSON
    } finally { inflight.delete(path); }
  })();
  inflight.set(path, p); return p;
}

async function fetchWithRetry(path: string, prev?: Entry, retries = 2): Promise<Entry> {
  for (let i = 0; ; i++) {
    if (Date.now() < Math.max(cooldownUntil, openUntil)) throw new Error("cooldown");
    const h: Record<string, string> = { "accept-encoding": "gzip" };
    if (process.env.MBTA_API_KEY) h["x-api-key"] = process.env.MBTA_API_KEY;
    if (prev?.lastModified) h["if-modified-since"] = prev.lastModified;
    let res: Response | undefined;
    try { res = await fetch(`https://api-v3.mbta.com${path}`, { headers: h, signal: AbortSignal.timeout(5000) }); }
    catch { /* network error or timeout: retry below */ }
    if (res) {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      if (res.status === 304 && prev) return { ...prev, fetchedAt: Date.now(), source: "v3" };
      if (res.ok) {
        if (Number(res.headers.get("x-ratelimit-remaining")) <= 2 && reset) cooldownUntil = reset;
        return { body: await res.json(), lastModified: res.headers.get("last-modified") ?? undefined,
                 fetchedAt: Date.now(), source: "v3" };
      }
      if (res.status === 429) { cooldownUntil = (reset || Date.now() + 60_000) + jitter(1000); throw new Error("429"); }
      if (res.status < 500) throw new Error(`HTTP ${res.status}`);  // 400/403/404: never retry
    }
    if (i >= retries) throw new Error("upstream failed");
    await sleep(jitter(500 * 3 ** i));                               // 500ms, 1500ms + jitter
  }
}
```

Usage: `getMbta("/vehicles?filter[route]=Red,...&include=trip", 15_000, () => fetchCdnVehiclesNormalized())`. The fallback function fetches `cdn.mbta.com/realtime/VehiclePositions_enhanced.json`, filters it to subway and maps it to our internal shape.

---

## 6. Crash history and prediction (static, no live API)

Crash data is **history, not live**. We ship a precomputed static JSON layer and our own backtested forecast. Nothing on this layer can rate-limit or fail at runtime.

**Data**
- Source: the Boston Vision Zero CKAN dump (`e4bfe397-6bfc-49c5-9367-c879fac7401d`).
- 44,985 usable rows: mv 33,915, ped 6,999, bike 4,071. Location types: Street 21,524, Intersection 20,769, Other 2,692.
- Dates run from 2015-01-01 to 2026-08-31 (local time).

| Year | Ped | Bike | All |
|---|---|---|---|
| 2015 | 783 | 502 | 4,103 |
| 2016 | 893 | 424 | 4,360 |
| 2017 | 772 | 390 | 4,531 |
| 2018 | 683 | 425 | 4,369 |
| 2019 | 696 | 365 | 4,350 |
| 2020 | 398 | 295 | 3,348 |
| 2021 | 357 | 239 | 3,911 |
| 2022 | 448 | 243 | 3,301 |
| 2023 | 588 | 389 | 3,538 |
| 2024 | 465 | 366 | 3,455 |
| 2025 | 571 | 256 | 3,412 |
| 2026 (Jan-Aug) | 345 | 177 | 2,307 |

COVID in 2020 cut all crashes by about 23% and ped crashes by about 43%. Ped and bike counts are still about 30% below 2015-19 levels.

**Method (what won the backtest)**
1. Build a grid of 250 m cells:
   - `i = floor((lat-42.2)/0.0022458)`, `j = floor((lon+71.2)/0.0030393)`.
   - Keep only rows inside the bbox lat 42.2-42.42, lon -71.2 to -70.98.
   - 1,706 cells have at least one crash. That is the denominator for every ranking.
2. Rank cells by their **historical ped+bike count**. A recency weight `sum(0.5^(age_years/2))` scores within about 1 point of the plain count; it is optional.
3. Spread the risk over time: expected crashes in cell c at hour-of-week h = cell yearly rate × the citywide hour-of-week share for that mode (168 bins). For bikes, also apply a 12-bin month factor.
4. Show it as tiers: top 1%, top 5%, top 10%, other.
- **Don't use** empirical-Bayes shrinkage toward the car-crash rate (it cut top-5% capture by 4-7 points) or 3×3 neighbour smoothing (it made things worse). Car-crash hotspots are not the same places as ped/bike hotspots. Per-cell hour profiles are too sparse (about 20 crashes per cell).

**Backtest** (train on 2015-2023, test on 2024-01 to 2026-08). Capture = share of test crashes that fall in the top-k% of cells.

| Mode (test n) | Model | Top 1% | Top 5% | Top 10% | Spearman |
|---|---|---|---|---|---|
| Ped (1,381) | random | 1 | 5 | 10 | |
| | **naive count** | **10.2** | **27.4** | **43.4** | **0.612** |
| | 2019-23 only | 10.5 | 26.7 | 39.6 | 0.574 |
| | recency (half-life 2 y) | 9.6 | 26.1 | 42.1 | 0.590 |
| | EB toward car-crash rate | 7.8 | 22.0 | 38.0 | 0.585 |
| | EB + neighbour smoothing | 7.8 | 24.3 | 38.7 | 0.594 |
| | oracle | 12.0 | 35.7 | 53.7 | |
| Bike (799) | **naive** | 9.1 | 28.2 | 43.9 | 0.488 |
| | recency | 9.1 | 28.4 | 42.2 | 0.467 |
| | EB | 5.3 | 21.4 | 36.0 | |
| | oracle | 12.5 | 40.9 | 62.5 | |
| Ped+bike (2,180) | **naive** | 8.3 | 25.9 | 42.2 | 0.666 |
| | recency | 8.2 | 26.2 | 41.4 | |
| | oracle | 10.1 | 32.0 | 49.7 | |
| MV (6,994) | naive | 9.4 | 29.1 | 43.2 | 0.800 |
| | oracle | 10.2 | 30.9 | 46.2 | |

- On a second split (train 2015-21, test 2022-23) the naive count also wins: ped 12.5 / 29.2 / 45.8, bike 9.5 / 31.6 / 47.0.
- **Bottom line:** the top 5% of cells (about 85 cells) catch about 27% of future ped/bike crashes. That is 5-6 times better than random and about 75-85% of the best any ranking could do. Prediction of *where* is real but modest.
- Hotspot stability: about half of the top-5% cells stay in the top 5% (53% ped, 46% bike).
- Hour-of-week model:
  - Ped: perplexity 142 against 168 for a uniform guess. The busiest 25% of weekly hours hold 41% of test crashes.
  - Bike: perplexity 136. The busiest 25% of weekly hours hold 46%.

**Time patterns** (r = correlation between the 2015-23 and 2024-26 profiles)

| Mode | Hour of day | Day of week | Hour of week | Month |
|---|---|---|---|---|
| Ped | r=0.96. Peak 3-7 pm (5 pm is about 8-9%), low 3-5 am | r=0.98. Fri highest (17%), Sun lowest (10%) | r=0.81. Fri 17:00 = 2.9× average; Tue/Wed/Thu 17:00 and Wed 16:00 = 2.3-2.4× | Weak (r=-0.18). Oct-Dec rise is mostly noise |
| Bike | r=0.95. Peaks 8 am (6.5-7%) and 5-6 pm (8-11%) | r=0.74. Weekdays higher | r=0.77. Thu 18:00 = 3.0×, Wed 08:00 = 2.9× | **Strong (r=0.92).** July is about 5× January; Jun-Sep holds about 50% of the year |
| MV | r=0.97 | r=0.96. Fri and Sat highest | r=0.91. Fri 16-17 = 1.8× | Mild |

**Top cells (2015-23 ped+bike count, with test rank out of 1,706)**

| # | Location | Train (ped + bike) | Test (ped + bike) | Test rank |
|---|---|---|---|---|
| 1 | Mass Ave & Gerard St / "Mass & Cass" (42.3317, -71.0706) | 62 + 21 | 11 + 8 | #1 |
| 2 | Mass Ave & Albany St (42.3335, -71.0735) | 58 + 21 | 13 + 4 | #2 |
| 3 | Mass Ave at Melnea Cass Blvd (42.3326, -71.0720) | 58 + 15 | 13 + 1 | #6 |
| 4 | Washington St & Talbot Ave, Codman Sq (42.2907, -71.0716) | 46 + 8 | 10 + 1 | #12 |
| 5 | Boylston St & Mass Ave (42.3475, -71.0881) | 30 + 22 | 7 + 5 | #10 |

Two more examples:
- Beacon St near Mass Ave is bike-dominated (35 bike crashes in training).
- Warren St & Zeigler St had 78 crashes in training but dropped to rank #30 in the test period, so hotspots can cool down.

**How to present it honestly in the app**
- **Map layer:** cells colored by tier (top 1%, 5%, 10%), with a ped/bike/all toggle. Tapping a cell shows:
  - the street label;
  - "N ped / M bike crashes since 2015, X in the last 2 years";
  - an hour-of-week strip, e.g. "Most crashes: weekdays 4-7 pm".
- **Route warning:** sum the cell rates along the walk or bike leg, and flag legs that enter a top-5% cell ("You pass 2 high-crash intersections"). Scale by the current hour-of-week factor. For bikes, also apply the month factor (summer about 2×, winter about 0.4×).
- **"How we know" panel:** "Ranking places by past crashes caught 27% of 2024-26 pedestrian/bike crashes in just 5% of the city's crash-prone area, 5-6x better than chance."
- **Label:** "Based on 2015-2026 Boston Vision Zero records. Historical, not live."
- **Caveats to state:**
  - The data includes only crashes with a 911 dispatch.
  - There is no severity field.
  - There is no exposure data (more people means more crashes), so "risk" means crash count, not risk per trip.
  - 2026 is partial.
  - Counts are still below pre-COVID levels, so show crashes per year from the last 3-5 years.
- **Build:** a script fetches the CSV, then:
  1. Parses `dispatch_ts` as UTC and converts it to America/New_York. The manual DST rule is UTC-4 from the second Sunday of March at 07:00 UTC to the first Sunday of November at 06:00 UTC, otherwise UTC-5.
  2. Assigns grid cells and stores per-cell counts (total, last 2 years, last 5 years, recency score).
  3. Stores a label per cell: the most common non-empty `street` + `xstreet1` pair. `street` is often blank, so fall back to `xstreet1`.
  4. Stores the centroid of each cell.
  5. Stores 168-bin hour-of-week shares per mode and the 12-bin month factor.
  6. Computes the tiers.
- The output is about 150-250 KB of JSON. Rerun the backtest (hold out the last 2-3 years) whenever the data refreshes.
- Reference scripts: `research/crash-backtest/crash_bt.py` (stdlib only; run `python -I crash_bt.py <crash.csv>`, about 1 min) and `research/crash-backtest/top.py`.

---

## 7. Gotchas

1. **Always send `filter[activity]` on `/alerts`.** Use `ALL`, or `BOARD,EXIT,RIDE,USING_WHEELCHAIR,USING_ESCALATOR`. Otherwise elevator alerts silently disappear as soon as any other filter is present.
2. `filter[datetime]=NOW` drops UPCOMING alerts.
3. Dedupe alerts by id. `informed_entity` repeats per route, platform, `door-*` and `place-*`. Each entity row is an AND of its fields.
4. `short_header` can be `''`, so fall back to `header`. `description` uses `\r\n`.
5. No endpoint gives elevator up/down status. `/facilities` is static and `/live_facilities` is parking-only (and returned empty). Outages come only from alerts.
6. `/stops?filter[route_type]=0,1&filter[location_type]=1` returns `[]`. Derive parent stations from the platforms.
7. Stop radius is in **degrees**, not meters.
8. Vehicles, predictions, stop_events and route_patterns use **child platform ids**. Map them to `place-*` via `parent_station`.
9. `filter[direction_id]` works only together with `filter[route]`. The meaning of direction 0/1 depends on the route.
10. Silver Line is route type 3 (bus). `filter[route_type]=0,1` leaves it out.
11. Predictions include past rows and CANCELLED or SKIPPED rows with null times, so filter them out. `status` and `trip_headsign` were null.
12. Predictions, schedules, stop_events, transfers, live_facilities and shapes all **require a filter**. Without one they return 400 `At least one filter[] is required.` (verified live for predictions, transfers and live_facilities; documented for shapes and stop_events).
13. Attribute name drift: the live JSON says `revenue`, the swagger says `revenue_status`. Read both.
14. `ADDED-*` trip ids are not in GTFS static. Always `include=trip`.
15. Vehicle `occupancy_status` is null and `speed` is mostly null. Use `carriages[]` for crowding.
16. A 429 has no `Retry-After`. Use `x-ratelimit-reset` (epoch seconds). A 304 has no rate-limit headers, so keep the last-seen values.
17. A bad API key returns a hard 403, not anonymous access.
18. The CDN realtime files have no CORS header (server-side only), use epoch timestamps and translation objects, cover all modes, and keep the V3-style effect in `effect_detail`.
19. SSE streaming needs a key (406 without one), and serverless timeouts may cut it (UNVERIFIED). Don't open SSE per browser client.
20. Facility type casing differs: `ELEVATOR` in the API, `elevator` in GTFS. Facility lat/lon are often null.
21. Each GTFS elevator appears as two directed pathway rows. Close both. 6 South Station bus-terminal elevators have no `facility_id`.
22. Route colors come without a leading `#`.
23. Crash layer: it is not live. Plain counts beat the fancier models. Prediction of *where* is modest (about 27% of future crashes in the top 5% of cells), so don't call it ML or "risk per trip".