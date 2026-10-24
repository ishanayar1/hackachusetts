# Implementation Plan: Step-free router

- [x] 1. Build static subway data from MBTA GTFS
  - `scripts/build-gtfs.ts` writes stations, network, pathways, facilities and parking to `public/data/`
  - _Requirements: 1.1, 4.1_

- [x] 2. In-station step-free graph
  - `edgeAllowed`, `reachable`, `stationPath` in `src/lib/router.ts`
  - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [x] 3. Station status and alternatives
  - `stationStatus` with `blockedBy`; `nearestStepFree` (k = 3)
  - _Requirements: 3.5, 4.4_

- [x] 4. Trip planner
  - `planStepFree` Dijkstra over (platform, route), typed failure reasons, approximate flag, entrance and exit ids
  - _Requirements: 1.3, 3.1–3.4, 4.1–4.3_

- [x] 5. Property-based tests
  - `tests/router.property.test.ts` covers properties 1–5 in the design
  - _Requirements: 1.3, 2.5, 3.5, 4.4_

- [x] 6. Route API with demo closures
  - `src/app/api/route/route.ts`, `parseClosedParam` and `planWithClosures` in `src/lib/lastmile-service.ts`
  - _Requirements: 2.1–2.4_

- [x] 7. Expose the planner to Kiro through MCP
  - `plan_step_free_route` tool in `mcp/mbta/server.ts`
  - _Requirements: 2.1, 2.2_

- [x] 8. Trip planner UI with "Demo: break an elevator"
  - `src/components/TripPlanner.tsx`
  - _Requirements: 2.2, 3.5_

- [ ] 9. Wheelchair walking leg (Valhalla, then OSRM foot, then straight line)
  - Planned as M6 in `docs/lastmile-plan.md`; no `src/lib/server/walk.ts` exists yet
