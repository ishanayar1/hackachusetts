# LastMile

**Step-free MBTA trips for people who can't take the stairs.**

An elevator breaks and a wheelchair user is stuck on a platform with no way out. LastMile stops that trip before it starts: it checks every elevator, ramp and lift on your route against live MBTA data, and reroutes around the broken ones.

Built for wheelchair users, parents with strollers, people with canes or walkers, older riders and anyone hauling luggage. Built end to end in Kiro for Hackachusetts 2026, Civic Action track.

## Features

**Plan the trip**
- **Step-free trip planner.** Subway routes that use only working elevators, ramps and lifts. Reroutes around live closures, names the entrance to use, and adds the walk at each end.
- **Tap the map for directions,** then Start and Close the trip.
- **Drive and park & ride,** with accessible parking on the map.
- **Safe-route assistant.** Ask for a bike route in plain words. It picks the route with the fewest recorded crashes, steers around the worst intersections and names the nearest MBTA stops.

**Know before you go**
- **Broken now.** Every elevator, escalator, ramp and portable lift out of service, live from the MBTA V3 API.
- **Plain-language alerts.** Claude rewrites each MBTA accessibility alert as one short sentence. The original text stays one tap away.
- **Station details.** Step-free status, accessible entrances, the door list, each facility's status and the next trains.
- **Live map.** Trains in motion, plus every elevator, lift, ramp and door with its out-of-service state.

**Watch the walk**
- **Crash spots.** Search Boston intersections by recorded pedestrian and bike crashes (Vision Zero data) and fly the map there.
- **Walk hazards.** Poor curb ramps, open 311 sidewalk and street-light reports, and fatal crash locations.
- **Weather on the walk** (National Weather Service) and **Bluebikes nearby** (GBFS).

**Made for you**
- **Accounts** with email, Google or GitHub. Onboarding asks how you travel, what you need and where you go. The planner and map adapt.
- **My stations.** Star your stations and get a phone alert (ntfy) when one stops being step-free. Checked every 10 minutes.

**Made for everyone**
- **Equity view.** How many people in environmental-justice neighborhoods live near a station that isn't step-free right now.
- **Six languages:** English, Español, Português, Kreyòl ayisyen, 中文 and Tiếng Việt.
- **Everything on the map is also a text list.** Finger-sized controls and a visible focus ring everywhere.
- **Map skins,** including satellite. **Installs on your home screen** like an app. **Demo mode** replays a saved MBTA snapshot.

**Stack:** Next.js 16, React 19, MapLibre, Tailwind 4, Better Auth with Postgres, Claude. Data from the MBTA V3 API and GTFS, Analyze Boston and MassGIS.

---

## How we used Kiro

LastMile is built on Kiro from the first commit to the last. Every teammate built in Kiro, and every answer below points to a file in this repo or a run we can replay.

### Kiro tools

The whole team built in **Kiro Crew** and **Kiro CLI**, sharing one `.kiro/` folder: the same steering, specs, hooks and MCP server for everyone.

- **Kiro Crew did the groundwork before the 11:30 build start.** We handed it our team brief and asked for complete research and groundwork. It checked every risky claim against the live MBTA API and GTFS feed, wrote the steering docs, hooks and MCP config itself, then fanned the rest out to five parallel subagents: the three specs, two reference docs, the data scripts, the MCP server and the web skeleton. It reviewed their output, fixed what was wrong, ran the tests and handed back a repo ready to push.
- **Kiro CLI built the app.** Each teammate ran Kiro in the terminal, inside the repo, with our steering, hooks and MCP server loaded (`.kiro/settings/cli.json`). Every feature on the list above went through it.

How they differ: Crew plans and delegates. It keeps memory, runs background subagents and checks their work. The CLI is one focused agent for hands-on edits. We used Crew for breadth up front and the CLI for depth during the build.

### Spec-driven development

**Specs came before code.** Crew wrote three spec triples from the brief: router, alerts and crash map. Each has `requirements.md` with EARS criteria ("WHEN … THEN the system SHALL …"), `design.md` and `tasks.md`. The router spec put our core promise in one testable line: no returned path ever contains a pathway served by a closed elevator. Kiro turned that line straight into a property test.

**The spec caught a bug in the first hour.** The design said elevators join to GTFS pathways by `facility_id`. One subagent matched them by stop-node endpoints instead and found 0 elevators. The spec listed the numbers to expect (125 stations, 101 accessible, 188 elevators, 185 with pathway rows), so Kiro saw the mismatch, fixed the join and reran it until every number matched. Vibe coding would have shipped a router with no elevators in it.

The specs now live in `.kiro/specs/` as `step-free-router`, `broken-now-alerts` and `crash-layer`, updated to match the shipped code. Every task links to a requirement number, and unbuilt work stays unchecked.

**Spec mode and vibe mode, each where it fits.** The core, where a wrong answer strands a person, went through specs: data build, live client, router, route API and MCP server landed with their tests in our first push at 12:33. Faster-moving UI work such as sign-in, onboarding, map skins and driving ran in Kiro chat, with steering and hooks keeping it inside the same rules. Specs kept the core correct and chat kept the UI moving, all inside Kiro.

### Agent hooks

Four hooks in `.kiro/hooks/` guard the rules a rider would feel first:

| Hook | Fires on | Does |
|---|---|---|
| `router-tests-on-save` | Saving the router or its tests | Runs unit, property and service tests: never route through a closed elevator |
| `mbta-alerts-tests-on-save` | Saving MBTA client code | Runs client and alerts tests, including the `filter[activity]=ALL` check |
| `a11y-check-on-ui-save` | Saving any `.tsx` UI file | Runs lint (jsx-a11y) and has the agent review labels, keyboard use, color-only status and list parity |
| `block-secrets-on-write` | Before any file write | Refuses to write keys or tokens and points to `.env` |

Crew's first version blocked commits that contained keys, using a scan script. Kiro hooks have no commit trigger, so we moved the check to fire before every file write, which stops a key earlier. The result: a broken route or a lost elevator alert fails seconds after saving, not on stage.

### Steering docs

Crew started with four steering docs: product, tech, data sources (every fact it had verified live) and accessibility language. We merged them into three, all `inclusion: always`: `product.md`, `tech.md` and `structure.md`.

**The strategy that mattered most: steer with verified facts, not opinions.** Crew proved live that elevator facility 869 returns 0 alerts without `filter[activity]=ALL` and 1 alert with it. That one fact became rule 4 in `tech.md`, a shared `ALERTS_PATH` constant in the client and the MCP server, and a test the alerts hook runs. Every agent sends the filter.

The language rules came from the same place: say "recorded crashes", never call a route "safe", and never show status by color alone.

### MCP

MCP worked for us in two ways.

**Our own MBTA server.** `lastmile-mbta` (`mcp/mbta/server.ts`, registered in `.kiro/settings/mcp.json`) gives Kiro four tools: `get_alerts`, `get_station`, `plan_step_free_route` and `get_predictions`. They run the same code as the app, so Kiro sees exactly what a rider sees. A real run on Oct 24:

- `get_alerts` for the Red Line returned 18 live alerts, with 31 facilities closed across the subway.
- `plan_step_free_route` from Park Street to Harvard: 12.5 minutes on the Red Line, entering by the Boston Common elevator entrance (elevators 978 and 979).
- The same call with `closed: ["978"]` kept the 12.5 minutes and switched to the Tremont St elevator entrance (elevators 804 and 808).

That is our demo moment, and Kiro could test it before the UI existed. Without MCP, checking a reroute meant reading raw JSON:API responses with nested includes by hand. Inputs are validated with zod, and the API key is never logged.

**Kiro Crew's own MCP.** Crew used its `kirocrew-core` server (`spawn_run`) to run the five groundwork subagents in parallel.

### Property-based testing

`tests/router.property.test.ts` uses fast-check to build random subway networks (3 to 8 stations, 1 to 3 lines, elevators, ramps, stairs, escalators, random closures) and checks six properties, 300 runs each:

1. A route never uses a closed facility. A separate BFS rechecks every route, so a router bug can't hide behind the same bug in the test.
2. Closing more facilities never makes a trip faster.
3. With no closures, any two stations on one line connect.
4. Routes exist only between step-free stations. Fallbacks are step-free, at most 3, and never the origin or destination.
5. `blockedBy` lists only that station's closed facilities.
6. Partial access and blocked platforms agree with the per-platform result.

We enabled PBT for the router requirements because a wrong answer there strands a person. Unit tests check the networks we think of; 300 random networks per property check the ones we don't. The router changed in two large feature merges after the first commit (walking routes, then wait times and door lists), and the properties held through both. Today all 305 tests across 27 files pass.

### Kiro powers and third-party tooling

Our bundled expertise came from Kiro Crew's built-in orchestration (memory, background subagents, review of their work) and from our own MCP server, which packages everything we learned about the MBTA API so any teammate's Kiro session has it. Crew's groundwork run also proved Valhalla wheelchair routing works with no key, which is why the app uses it for walking legs. The build pulls in other free third-party services too: ntfy for phone alerts, the National Weather Service and the Bluebikes GBFS feed.
