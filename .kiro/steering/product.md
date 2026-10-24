---
inclusion: always
---

# Product: LastMile

Source of truth: `docs/lastmile-plan.md`. This file is the short version for agents.

## What it is

LastMile is a mobile-first web app for Boston subway riders who cannot use stairs:
wheelchair users, parents with strollers, people with canes, injuries or luggage, and
older riders. It shows which MBTA elevators, escalators, ramps and lifts are broken right
now, plans step-free trips that route around those closures, and shows recorded
pedestrian and bike crash history near stations.

Hackathon: Hackachusetts, 2026-10-24, Civic Action track. Feature freeze 5:30 PM,
submission 8:00 PM.

## Features that exist in code

| Feature | Where |
|---|---|
| Stations by step-free status (icon and text, never color alone) | `src/app/api/stations/status/route.ts`, `src/components/MapView.tsx` |
| "Broken now" alerts feed, with an escalator toggle | `src/app/api/alerts/route.ts`, `src/components/BrokenNow.tsx` |
| Step-free trip planner that avoids closed facilities | `src/lib/router.ts`, `src/app/api/route/route.ts`, `src/components/TripPlanner.tsx` |
| "Break an elevator" demo control | `closed=` param on `/api/route`, `src/components/TripPlanner.tsx` |
| Station page: facilities, closures, parking, next trains | `src/app/api/station/[id]/route.ts`, `src/components/StationDetails.tsx` |
| Recorded crash history layer and searchable list | `src/lib/crash.ts`, `src/app/api/crash/locations/route.ts`, `src/components/CrashSpots.tsx` |
| MBTA MCP server for Kiro | `mcp/mbta/server.ts`, `.kiro/settings/mcp.json` |

## Scope

- Subway only: Red, Orange, Blue, Green-B/C/D/E, Mattapan. The Silver Line is filed as a
  bus route in the API, so it is out. Commuter rail and buses are out.
- Not building today: fatal crash markers, resident-reported danger spots, weather,
  Bluebikes, an equity view, translation. Mention them as future work only.

## Language rules (users read these words)

- Crash data is history. Say "recorded crashes" and "Historical, not live". Never call
  a place or route "safe" or "dangerous". The team model's number is labelled
  "Team model estimate" and is never the default view.
- Never say "spots free now" for parking. There is no live occupancy data.
- Show "Not official MBTA information. Confirm before you travel."
- Every status has an icon or text, never color alone.
- Location stays on the device.
