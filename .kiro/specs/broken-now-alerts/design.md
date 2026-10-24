# Design: "Broken now" alerts feed

## Overview

Three layers, each testable on its own:

1. `src/lib/mbta/client.ts`: framework-agnostic MBTA V3 GET with TTL cache, request
   coalescing, `If-Modified-Since`, retries, 429 cooldown and a
   last-good → fallback → throw chain.
2. `src/lib/mbta/alerts.ts`: pure normalization (`normalizeAlerts`, `isActiveAt`,
   `closedFacilityIds`, `toStationId`).
3. `src/app/api/alerts/route.ts` and `src/components/BrokenNow.tsx`: thin handler and UI.

## Architecture

```
BrokenNow.tsx ──SWR 30 s──► /api/alerts ──► mbtaGet(ALERTS_PATH, { ttlMs: 30_000, fallback: loadDemoAlerts })
                                                │  v3 → cache (last good) → demo snapshot → 503
                                                ▼
                                normalizeAlerts(body, getParentOf(), now)
                                closedFacilityIds(alerts, now)
```

The same `getLiveAlerts()` in `src/lib/lastmile-service.ts` feeds `/api/route`,
`/api/station/[id]`, `/api/stations/status` and the MCP tools `get_alerts`,
`get_station` and `plan_step_free_route`.

## Components and Interfaces

- `ALERTS_PATH = '/alerts?filter[route_type]=0,1&filter[activity]=ALL&include=facilities'`
- `normalizeAlerts(json, parentOf, now): NormalizedAlert[]`, sorted active first, then severity, then id.
- `closedFacilityIds(alerts, now): string[]`
- `envelope(data, result)`, `jsonWithCache(body, 30, 60)`, `unavailable('Alerts')` in `src/lib/server/mbta.ts`.

## Data Models

`NormalizedAlert` in `src/lib/mbta/types.ts`: `id`, `effect`, `header`, `shortHeader`,
`description`, `url`, `severity`, `lifecycle`, `activePeriods`, `activeNow`,
`stationIds`, `routeIds`, `facilityIds`, `activities`, `updatedAt`.

## Error Handling

- Garbage input → empty list. Unknown stop ids are dropped, not guessed.
- Upstream failure → last good data (`source: 'cache'`) → demo snapshot
  (`source: 'demo'`) → 503 with "Alerts temporarily unavailable" and `no-store`.
- The UI shows a source badge so stale or demo data is visible.

## Testing Strategy

- `tests/alerts.test.ts`: saved V3 fixture (`tests/fixtures/alerts.json`) plus synthetic
  cases: dedupe, platform and door mapping, active-period logic, garbage input, and the
  Downtown Crossing elevator closure appearing in `closedFacilityIds`.
- `tests/client.test.ts`: cache, retries, 429 cooldown and fallback chain with mocked fetch.
