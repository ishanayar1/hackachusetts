# Implementation Plan: "Broken now" alerts feed

- [x] 1. MBTA V3 client with cache, retries and fallback chain
  - `src/lib/mbta/client.ts`; tests in `tests/client.test.ts`
  - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [x] 2. Alert normalization and closed facility ids
  - `src/lib/mbta/alerts.ts`; tests in `tests/alerts.test.ts`
  - _Requirements: 1.1–1.4, 2.1–2.4_

- [x] 3. Demo snapshot for the fallback
  - `scripts/capture-demo.ts` writes `public/data/demo-alerts.json` and test fixtures
  - _Requirements: 3.4_

- [x] 4. `/api/alerts` route handler
  - `src/app/api/alerts/route.ts` with `envelope`, `jsonWithCache(…, 30, 60)`, `unavailable`
  - _Requirements: 3.1, 3.4_

- [x] 5. Share live closures with the router, station status and MCP
  - `getLiveAlerts` in `src/lib/lastmile-service.ts`; `get_alerts` tool in `mcp/mbta/server.ts`
  - _Requirements: 2.1_

- [x] 6. "Broken now" UI
  - `src/components/BrokenNow.tsx`: access-first grouping, escalator toggle, `aria-live` count, icons with text labels; `useAlerts` polls every 30 s
  - _Requirements: 4.1–4.6_

- [ ] 7. "My stations" in-app alert when a saved station breaks
  - Planned as M9 in `docs/lastmile-plan.md`; not found in `src/` yet
