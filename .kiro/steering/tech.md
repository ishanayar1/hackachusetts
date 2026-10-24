---
inclusion: always
---

# Tech: LastMile

Source of truth: `docs/tech-stack.md` and the "For AI agents" rules in `docs/lastmile-plan.md`.

## Stack (as installed in `package.json`)

- TypeScript everywhere. Next.js 16 App Router, React 19.
- Tailwind CSS 4 (via `@tailwindcss/turbopack`).
- MapLibre GL through `react-map-gl/maplibre`, OpenFreeMap tiles (no key).
- SWR for live data in the browser (`refreshInterval`, 30 s for alerts and status).
- Vitest for tests, fast-check for property-based tests.
- `@modelcontextprotocol/sdk` + `zod` for the MCP server in `mcp/mbta/`.
- `tsx`, `fflate`, `csv-parse` for data build scripts in `scripts/`.

Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/` before
writing framework code. `cacheComponents` is on in `next.config.ts`, so route handlers
call `await connection()` instead of `export const dynamic = 'force-dynamic'`.

## Rules

1. App Router only (`src/app`). No `pages/` directory.
2. Never call the MBTA API from the browser. All calls go through our route handlers.
3. Secrets live only in route handlers and `src/lib/server/*` files that start with
   `import 'server-only'`. Never prefix a key with `NEXT_PUBLIC_`. Never log the key.
4. Every `/alerts` call includes `filter[activity]=ALL`. Use `ALERTS_PATH` from
   `src/lib/mbta/alerts.ts`; do not build the query by hand.
5. Route handlers return `{ data, source, ageSec, fetchedAt }` (see `envelope()` in
   `src/lib/server/mbta.ts`) and set `Cache-Control` with `s-maxage` and
   `stale-while-revalidate` (`jsonWithCache()`). Errors use `unavailable()`, which never
   echoes upstream details.
6. Fallback chain for MBTA calls: live V3 API (cached) then last good data then
   `public/data/demo-alerts.json`. See `src/lib/mbta/client.ts`.
7. Static data (stations, platforms, pathways, facilities, parking, line shapes) comes
   from GTFS at build time (`npm run build:data`), not the live API.
8. The router must never use a closed elevator, ramp or lift, and never stairs or
   escalators. Any router change must keep `tests/router.property.test.ts` green.
9. Validate input at every boundary: station ids match `place-*`, facility id lists are
   capped at 50, query params are range-checked (see `parseCrashQuery`).
10. The map component is `'use client'` and loaded with `next/dynamic`, `ssr: false`.
    Map features are GeoJSON `<Source>` + `<Layer>`, not many `<Marker>`s.
11. Every screen works without the map: real buttons, labelled controls, an
    `aria-live` region for alert counts, touch targets at least 44 px.

## Commands

```bash
npm test            # vitest run
npm run typecheck   # next typegen && tsc --noEmit
npm run lint
npm run build:data  # rebuild public/data/*.json from MBTA GTFS
npm run mcp         # start the MBTA MCP server (stdio)
```
