# How we used Kiro

LastMile is a step-free subway trip planner for Boston (Hackachusetts 2026, Civic Action
track). This page answers the submission questions about Kiro. Every claim points to a
file in this repo. Items marked **TODO (team)** are things the repo cannot prove; a
teammate must fill them in or delete them before we submit.

## Summary

| Question | Short answer | Evidence |
|---|---|---|
| Kiro tools | **TODO (team)**. The repo holds Kiro CLI and Kiro Crew settings | `.kiro/settings/cli.json`, `.kiro/settings/.kirocrew-cli-settings.lock` |
| Spec-driven vs vibe coding | 3 specs in Kiro's requirements / design / tasks format. **TODO (team)**: say how much was vibe coded | `.kiro/specs/*/` |
| Hooks | None committed yet. **TODO (team)** | `.kiro/hooks/` does not exist |
| Steering | 3 steering files, always included | `.kiro/steering/product.md`, `tech.md`, `structure.md` |
| MCP | Our own MBTA MCP server with 4 tools, registered for Kiro | `mcp/mbta/server.ts`, `.kiro/settings/mcp.json` |
| Property-based tests | 5 fast-check properties on the step-free router, 300 runs each | `tests/router.property.test.ts` |
| Powers | **TODO (team)** | Nothing in the repo |

## Kiro tools: IDE, CLI, Web, Crew

**TODO (team):** list which of Kiro IDE, Kiro CLI, Kiro Web and Kiro Crew each person
used, and for what. One line each is enough.

What the repo shows:

- `.kiro/settings/cli.json` holds Kiro CLI settings (`toolSearch.*`) and Kiro Crew skill
  discovery settings (`kirocrew.skillDiscovery.*`).
- `.kiro/settings/.kirocrew-cli-settings.lock` is a Kiro Crew lock file.
- `.kiro/settings/mcp.json` registers our MCP server for Kiro (see MCP below).

## Spec-driven vs vibe coding

Specs live in `.kiro/specs/`, one folder per main feature, each with
`requirements.md` (user stories with EARS-style "WHEN … THEN the system SHALL …"
criteria), `design.md` and `tasks.md`:

| Spec | Code it covers | Tests |
|---|---|---|
| `.kiro/specs/step-free-router/` | `src/lib/router.ts`, `src/app/api/route/route.ts`, `TripPlanner.tsx` | `tests/router.property.test.ts`, `tests/router.unit.test.ts` |
| `.kiro/specs/broken-now-alerts/` | `src/lib/mbta/client.ts`, `src/lib/mbta/alerts.ts`, `src/app/api/alerts/route.ts`, `BrokenNow.tsx` | `tests/alerts.test.ts`, `tests/client.test.ts` |
| `.kiro/specs/crash-layer/` | `src/lib/crash.ts`, `src/app/api/crash/locations/route.ts`, `CrashSpots.tsx`, `HexDetails.tsx` | `tests/crash.test.ts` |

Each `tasks.md` links tasks to requirement numbers and leaves the unbuilt parts
unchecked: the wheelchair walking leg, "My stations" alerts, and the crash warning on
a planned walk.

Be honest about the order. The spec files in this commit were written after the code,
to match what was built. The plan they come from, `docs/lastmile-plan.md`, was written
before hacking started and has the feature list (M1 to M11), rules for agents, and
risks.

**TODO (team):** say which parts were built from a spec in Kiro's spec mode and which
were vibe coded in chat. Example to adapt: "The router started from a spec (the
property 'never route through a closed elevator' came first); the map UI was vibe coded."

## Hooks

There are no hook files in the repo. `.kiro/hooks/` does not exist.

The plan (`docs/lastmile-plan.md`, Build plan) lists three hooks we meant to add:

1. Run the router tests when `src/lib/router.ts` is saved.
2. Run an axe-core accessibility check when a UI file is saved.
3. Block commits that contain API keys.

**TODO (team):** if anyone made hooks in Kiro, commit them under `.kiro/hooks/` and
describe them here. If not, remove this section or say "we did not use hooks".

## Steering

Three steering files, all with `inclusion: always`, so Kiro loads them in every chat:

- `.kiro/steering/product.md`: who LastMile is for, which features exist and where,
  scope (subway only), and wording rules ("recorded crashes", "Historical, not live",
  never "safe", no color-only status).
- `.kiro/steering/tech.md`: the stack as installed, plus 11 rules agents must follow.
  For example: never call the MBTA API from the browser; every `/alerts` call uses
  `ALERTS_PATH` with `filter[activity]=ALL`; secrets stay in `server-only` files; any
  router change must keep `tests/router.property.test.ts` green.
- `.kiro/steering/structure.md`: the folder map and where new code goes.

They summarize `docs/lastmile-plan.md` and `docs/tech-stack.md`, which hold the full
reasoning.

## MCP

We wrote our own MCP server so Kiro could ask live questions about the MBTA while we
built: `mcp/mbta/server.ts` (commit `0ac4628`, "feat: MBTA MCP server for Kiro").

- **Registered for Kiro** in `.kiro/settings/mcp.json` as `lastmile-mbta`:
  `npx tsx --env-file=.env mcp/mbta/server.ts` (stdio). Also `npm run mcp`.
- **Tools:**
  | Tool | What it returns |
  |---|---|
  | `get_alerts` | Current subway alerts, optionally by station or route, plus `closedFacilityIds` |
  | `get_station` | Facilities with closed flags, step-free status and which closures block it, parking, alerts |
  | `plan_step_free_route` | A step-free trip between two stations, avoiding live closures plus extra facility ids you pass |
  | `get_predictions` | Next departures at a station |
- **Same code as the app.** The tools call `src/lib/lastmile-service.ts`,
  `src/lib/router.ts` and `src/lib/mbta/client.ts`, so the answer in Kiro matches the
  answer on screen. They use the same cache, retry and demo-snapshot fallback.
- **Input checks.** Inputs are checked with zod (station ids must match `place-*`;
  at most 50 extra closed ids). Logs go to stderr only. The API key is never logged.

**TODO (team):** add one or two real examples of asking Kiro something through this
server, such as "Which Red Line elevators are closed right now?" or "Plan a step-free
trip from Park Street to Harvard with one Park Street elevator closed", and what we did with the answer.

## Property-based tests

`tests/router.property.test.ts` uses fast-check with Vitest. It builds random but seeded
subway networks (3 to 8 stations, 1 to 3 lines, elevators, ramps, stairs, escalators and random closures) and
checks five properties, 300 runs each:

1. **A returned route never uses a closed facility.** The test rechecks street access
   at both ends and every platform change with its own simple BFS, separate from the
   router's code.
2. **Closing more facilities never makes the best route faster.**
3. **With no closures on a fully accessible network, any two stations on one line
   connect.**
4. **A route exists only between step-free stations.** When it fails, the
   alternatives are step-free, at most 3, and never the origin or destination.
5. **`blockedBy` lists only closed facilities of that station**, and reopening them
   restores access.

Property 1 is the product's core promise: never send a wheelchair user to a broken
elevator. Example-based tests in `tests/router.unit.test.ts`, `tests/alerts.test.ts`,
`tests/client.test.ts`, `tests/crash.test.ts`, `tests/live.test.ts` and
`tests/static-data.test.ts` cover the rest.

Run them:

```bash
npm test
```

## Powers

**TODO (team):** name any Kiro power we installed and what it did. The repo has no
record of one. The plan (`docs/lastmile-plan.md`, Risks: "Kiro judging") set a goal of
using at least one. If we did not, say so.

## The `.kiro` folder

`/.kiro` is at the repo root and is not in `.gitignore`. The `.gitignore` has a comment
saying not to ignore it, because the rules disqualify submissions without it.
