# Design: Recorded crash layer

## Overview

`crash-risk/predict.py` (Python, offline) turns Vision Zero records into H3 cells with
recorded counts, a yearly model estimate and a Nominatim place label, written to
`crash-risk/risk.geojson` and copied to `public/data/crash-risk.geojson`. The Next.js
app serves it two ways: the map reads the GeoJSON file directly, and the searchable
list calls `/api/crash/locations`.

## Architecture

```
public/data/crash-risk.geojson
   ├──► MapView.tsx  <Source id="crash"> + crash-fill / crash-outline layers (toggle: off | recorded | model)
   └──► src/lib/server/crash-data.ts  getCrashSpots()  (read once per process, cached)
            ▼
        src/lib/crash.ts  toCrashSpots → queryCrashSpots
            ▼
        /api/crash/locations?q=&limit=&sort=   (s-maxage 3600, swr 86400)
            ▼
        CrashSpots.tsx (list, search, sort) → HexDetails.tsx (one area)
```

## Components and Interfaces

- `toCrashSpots(fc: unknown): CrashSpot[]`
- `queryCrashSpots(spots, { q, limit, sort }): { count, results }`
- `parseCrashQuery(params): { ok: true, value } | { ok: false, error }`
- `getCrashSpots(origin?)`: reads from disk, falls back to fetching `/data/crash-risk.geojson` from our own origin, coalesces concurrent loads.
- UI: `CrashSpots.tsx`, `HexDetails.tsx`, `MapKey.tsx`.

## Data Models

`CrashSpot`: `hex`, `label`, `lat`, `lng`, `pedBike`, `ped`, `bike`, `mv`, `total`,
`estimatePerYear`. The envelope `source` is `'cache'` because this is our stored copy,
not a live call.

## Error Handling

- Bad rows are skipped in `toCrashSpots`; bad params return 400; unreadable or empty
  data returns 503 via `unavailable('Crash history')`.
- The list falls back to parsing the static GeoJSON in the browser when the API fails.

## Testing Strategy

`tests/crash.test.ts`: property mapping and row skipping, junk input, both sort orders,
case-insensitive search and `count`, limit clamping without mutating input, query
validation, and checks on the real file (1,081 spots, each labelled and inside Boston),
skipped when the file is absent.
