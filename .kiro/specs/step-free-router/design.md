# Design: Step-free router

## Overview

A pure TypeScript router (`src/lib/router.ts`, no I/O) runs Dijkstra over subway
platforms using GTFS-derived static data in `public/data/`. In-station movement uses the
GTFS pathways graph filtered to step-free edges. Closures are a `Set` of facility ids
passed in by the caller, so the same function serves the web API, the MCP server and
the tests.

## Architecture

```
public/data/{stations,network,pathways}.json   (built by scripts/build-gtfs.ts)
        │
        ▼
src/lib/router.ts  planStepFree(data, { from, to, closed })
        ▲                         ▲
src/lib/lastmile-service.ts  planWithClosures(data, from, to, liveClosed, extraClosed)
        ▲                         ▲
src/app/api/route/route.ts   mcp/mbta/server.ts (plan_step_free_route)
```

Live closures come from `getLiveAlerts()` → `closedFacilityIds()` in
`src/lib/mbta/alerts.ts`. Demo closures come from the `closed=` query param.

## Components and Interfaces

- `edgeAllowed(edge, closed)`: false for stairs (mode 2), escalators (mode 4) and closed facilities.
- `reachable(sp, fromIds, toIds, closed)`: BFS over allowed edges inside one station.
- `stationPath(...)`: shortest allowed path by seconds, returning the facility ids it uses.
- `stationStatus(data, stationId, closed)`: `{ stepFree, approximate, platforms, blockedBy }`.
- `nearestStepFree(data, lat, lon, closed, k = 3, exclude)`: haversine-ranked step-free stations.
- `planStepFree(data, { from, to, closed })`: returns `RouteOk | RouteFail`.

Search state is `(platform, route on board)`; route `''` means not on a train. Ride
edges come from scheduled trip times. Transfers cost the in-station path time with a
minimum of `MIN_TRANSFER_MIN` (2), or `FALLBACK_TRANSFER_MIN` (3) at stations with no
pathway data.

## Data Models

See `src/lib/mbta/types.ts`: `Station`, `Network`, `StationPathways`, `PathwayEdge`.
Results: `RideLeg`, `TransferLeg`, `RouteOk`, `RouteFail` in `src/lib/router.ts`.

## Error Handling

- Unknown ids, non-step-free ends and disconnected graphs return typed failure reasons,
  never throw.
- The route handler validates `from`/`to` against `STATION_ID_RE` and `closed` with
  `parseClosedParam`, returning 400 on bad input, and 503 via `unavailable()` when static
  data or alerts fail. Live alerts fall back to `public/data/demo-alerts.json`.

## Testing Strategy

- `tests/router.property.test.ts` (fast-check, 300 runs each) on seeded synthetic networks:
  1. a returned route never uses a closed facility (rechecked by an independent BFS);
  2. closing more facilities never makes the best route faster;
  3. on a fully accessible network with no closures, any two stations on one line resolve;
  4. a route exists only between step-free stations, and alternatives are step-free, at most 3, never the ends;
  5. `blockedBy` lists only closed facilities of that station, and reopening them restores access.
- `tests/router.unit.test.ts`: example-based checks on the real static data.
- `tests/static-data.test.ts`: shape checks on `public/data/*.json`.
