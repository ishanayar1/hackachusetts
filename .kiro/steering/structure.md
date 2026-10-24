---
inclusion: always
---

# Structure: LastMile

```
.kiro/
  steering/            product.md, tech.md, structure.md (this file)
  specs/               step-free-router/, broken-now-alerts/, crash-layer/
  settings/mcp.json    registers the lastmile-mbta MCP server
mcp/mbta/server.ts     MCP server (stdio): get_alerts, get_station, plan_step_free_route, get_predictions
scripts/
  build-gtfs.ts        MBTA GTFS zip -> public/data/*.json
  capture-demo.ts      saves a live alerts snapshot as the demo fallback
public/data/           stations, network, pathways, facilities, parking, lines.geojson,
                       crash-risk.geojson, demo-alerts.json (committed, built offline)
src/
  app/
    page.tsx, layout.tsx, manifest.ts
    api/alerts/            live alerts + closedFacilityIds
    api/stations/status/   step-free status of every station
    api/station/[id]/      one station: facilities, status, parking, alerts
    api/route/             step-free trip plan (+ closed= demo closures)
    api/predictions/       next trains
    api/vehicles/          train positions
    api/crash/locations/   recorded crash spots (?q=&limit=&sort=)
  components/          LastMileApp, MapClient/MapView (client-only map), BrokenNow,
                       TripPlanner, StationDetails, CrashSpots, HexDetails, MapKey, Tabs, ui
  lib/
    router.ts            step-free Dijkstra over platforms + in-station pathways
    lastmile-service.ts  glue shared by route handlers and the MCP server
    crash.ts             pure crash-spot parsing, query and validation
    mbta/                client (cache, retries, fallback), alerts, live, types
    server/              'server-only' wrappers: mbta.ts, static-data.ts, crash-data.ts
    ui/                  client hooks (SWR), formatters, geo helpers
tests/                 Vitest; router.property.test.ts uses fast-check; fixtures/ holds saved V3 responses
crash-risk/            standalone Python crash model that produced crash-risk.geojson
docs/                  lastmile-plan.md, tech-stack.md, mbta-v3-reference.md, KIRO.md
```

## Where new code goes

- Pure logic with no I/O: `src/lib/` (framework-agnostic, so tests and the MCP server can import it).
- Anything that reads secrets or disk: `src/lib/server/` with `import 'server-only'`.
- New API: `src/app/api/<name>/route.ts`, thin, delegating to `src/lib/`.
- Tests: `tests/<module>.test.ts`; property tests named `*.property.test.ts`.
- Never write files to the repo root. Never gitignore `/.kiro`.
