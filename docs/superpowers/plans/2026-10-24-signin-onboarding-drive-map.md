# Sign-in Gate, Onboarding, Driving, Map Skins and On-Map Accessibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LastMile requires sign-in, asks a short onboarding (main service, access needs, saved places), adds a driving / park-and-ride planner, map skins incl. satellite, elevators/lifts/doors drawn on the map, and a minimal default map that shows only predicted high-risk crash zones.

**Architecture:** Server-side session check in `src/app/page.tsx` redirects to `/login` or `/welcome`. One Better Auth `json` user field `profile` holds the onboarding answers (zod-validated, shared schema in `src/lib/profile.ts`). Geocoding and car routing are server routes over free OSM services (Nominatim, OSRM car), built the same way as `/api/walk`. Map skins are a pure lookup (`src/lib/ui/map-skins.ts`) fed into the existing `MapView` style fallback chain. Accessibility points are a new static `public/data/access.geojson` written by `scripts/build-gtfs.ts`, coloured live from the `closedFacilityIds` the app already fetches.

**Tech Stack:** Next.js 16.4 (App Router, `proxy.ts` not needed), React 19.3, Better Auth 1.7 + Postgres, MapLibre 6 via react-map-gl 8, SWR, zod 4, vitest 5.

**Spec:** the user's request in chat (2026-10-24), restated here:
1. Login page first; nobody uses the app without signing in.
2. After first sign-in: a few questions — main type of service (the primary question), home, work and other places to save.
3. Something for people travelling in their own vehicle (app today is station-to-station MBTA only).
4. Satellite map and different map skins.
5. Accessibility (ramps, lifts/elevators) shown inside the map itself, not only in side-panel cards.
6. Default map = predicted accident-prone zones only; hide low-risk dots; keep the map minimal.
7. (added 2026-10-24) Icons for everything on the map: crash zones as traffic warning-sign icons, lift/elevator icons that turn red when broken, icons for every other point layer.

## Global Constraints

- Next 16 has breaking changes: read `node_modules/next/dist/docs/` before touching routing/redirect APIs (AGENTS.md rule).
- Every map layer also has a text equivalent in the panel (existing rule, `MapView.tsx:3`). Side-panel lists stay, collapsed; the map becomes the primary view.
- All UI strings go through `useT()` / `t()` (`src/lib/i18n.ts`); English string = key.
- Touch targets ≥ 44px (`min-h-11`), status never by colour alone (symbol + words), honour `prefers-reduced-motion`.
- No new npm dependencies. Upstreams: Nominatim `https://nominatim.openstreetmap.org/search`, OSRM car `https://routing.openstreetmap.de/routed-car/route/v1/driving`, Esri World Imagery `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, OpenFreeMap styles `positron|liberty|bright|dark`. All four verified reachable 2026-10-24.
- Server fetches send `User-Agent: LastMile hackathon app (accessible transit trip planner)`, 6 s timeout, in-memory cache (same pattern as `src/lib/walk.ts`).
- Coordinates validated against `BOSTON_BBOX` (`src/lib/walk.ts:51`) at every trust boundary (API params, profile field).
- `auth.ts` and anything it imports use relative imports (auth CLI does not resolve `@/`).
- Commits: conventional type prefix, no `Co-Authored-By` trailer (user's global CLAUDE.md wins over AGENTS.md).
- Work on branch `feat/signin-onboarding-drive-map` off `main`.

## Review Focus

1. **Signed-out deep link / stale cookie** — visiting `/` with an expired or forged session cookie must land on `/login`, not a blank app. Pinned by `gateRedirect` tests (Task 4).
2. **Signed-in user with no profile (accounts made before this change)** — must be sent to `/welcome`, not crash on `session.user.profile === null`. Pinned in Task 4 tests.
3. **Address search returns nothing / Nominatim down / address outside Boston** — onboarding must still let the user skip or finish; API returns `[]` not 500. Pinned in Task 5 tests.
4. **Satellite skin fails to load (tile host blocked)** — map falls back to Light, does not show "map could not load". Pinned in Task 2 test of `skinStyles`.
5. **Elevator with no coordinates in GTFS (185 of 237 lack `facility_lat`)** — drawn at pathway node or station point and marked approximate, never dropped silently or placed at 0,0. Pinned in Task 3 tests of `facilityPosition`.

---

### Task 1: Minimal default map — predicted high-risk zones only, icons for every point layer

**Files:**
- Modify: `src/lib/ui/format.ts:245-251` (add constants + `crashFilter`)
- Modify: `src/components/MapKey.tsx:15` (`DEFAULT_LAYERS`), legend rows for model mode
- Modify: `src/components/LastMileApp.tsx` (`useState<CrashMode>('recorded')` → `DEFAULT_CRASH_MODE`)
- Modify: `src/components/MapView.tsx:290-322` (filter on `crash-points`)
- Create: `src/lib/ui/map-icons.ts` (icon names + canvas drawing, client only)
- Test: `tests/ui-format.test.ts`, `tests/map-icons.test.ts`

**Amendment (spec item 7):** every point layer draws an icon (symbol layer, `icon-allow-overlap: true`), drawn in code on canvas like the existing arrows — no sprite, no glyph dependency for marks:
- crash zone: triangular warning sign (black border, black `!`), fill = bin color; shown bins recoloured `#facc15` / `#f97316` / `#dc2626` (yellow, orange, red); size grows with zoom.
- fatal crash: black circle with white `✕`. Resident danger report: purple rounded square with white `!`. Curb ramp: orange-brown square with white ramp wedge (lip = white border + bar).
- station: green circle with white wheelchair (step-free), green with amber ring and `!` (partial), white with red ring and red `✕` (not step-free), grey with `?` (unknown).
- trains keep arrow + dot.
- Produces: `warnIconName(color: string): string` (`lm-warn-<hex without #>`), `STATION_ICON: Record<'yes'|'partial'|'no'|'unknown', string>`, `addMapIcons(map: maplibregl.Map, extraColors?: string[]): void`.

**Interfaces:**
- Produces: `DEFAULT_CRASH_MODE: CrashMode = 'model'`; `MODEL_MIN_SHOWN = 0.5`; `crashFilter(mode: CrashMode): unknown[] | undefined` (MapLibre filter expression, `undefined` = no filter); `DEFAULT_LAYERS` all `false`.

- [ ] **Step 1: Create branch** — `git switch -c feat/signin-onboarding-drive-map`
- [ ] **Step 2: Write failing tests** in `tests/ui-format.test.ts`:

```ts
import { crashFilter, DEFAULT_CRASH_MODE, MODEL_BINS, MODEL_MIN_SHOWN } from '@/lib/ui/format';
import { DEFAULT_LAYERS } from '@/components/MapKey';
it('defaults to the model and hides the low-risk bin', () => {
  expect(DEFAULT_CRASH_MODE).toBe('model');
  expect(MODEL_MIN_SHOWN).toBe(MODEL_BINS[1].min);
  expect(crashFilter('model')).toEqual(['>=', ['get', 'risk_yr'], 0.5]);
  expect(crashFilter('recorded')).toBeUndefined();
});
it('starts with every optional layer off', () => {
  expect(Object.values(DEFAULT_LAYERS).every((v) => v === false)).toBe(true);
});
```
(If importing a `'use client'` .tsx into vitest fails, move `DEFAULT_LAYERS` to `src/lib/ui/format.ts` and re-export it from `MapKey.tsx`.)

- [ ] **Step 3: Run** `npx vitest run tests/ui-format.test.ts` — expect FAIL (`crashFilter` not exported).
- [ ] **Step 4: Implement.** Constants + `crashFilter` in `format.ts`. `MapView` `crash-points` layer gets `filter={crashFilter(crashMode)}`; `crash-selected` unchanged. `LastMileApp` initial mode `DEFAULT_CRASH_MODE`. `MapKey` legend in model mode lists `MODEL_BINS.slice(1)` plus one line `t('Intersections under 0.5 crashes a year are hidden to keep the map clear.')`. `DEFAULT_LAYERS` = all `false`.
- [ ] **Step 5: Run** `npx vitest run` — all PASS.
- [ ] **Step 6: Commit** `feat(map): minimal default map with predicted high-risk zones only`

---

### Task 2: Map skins incl. satellite

**Files:**
- Create: `src/lib/ui/map-skins.ts`
- Modify: `src/components/MapView.tsx:12-15, 160-190, 258-262` (replace `STYLES` with skin chain)
- Modify: `src/components/MapKey.tsx` (skin radio group, top of key)
- Modify: `src/components/LastMileApp.tsx` (hold skin state, pass to `MapClient` and `MapKey`)
- Modify: `src/components/MapClient.tsx` only if it narrows props
- Test: `tests/map-skins.test.ts`

**Interfaces:**
- Produces:
  - `type MapSkin = 'light' | 'streets' | 'bright' | 'dark' | 'satellite'`
  - `SKINS: { id: MapSkin; label: string }[]` labels: `Light`, `Streets`, `Bright`, `Dark`, `Satellite`
  - `skinStyles(id: string): (string | StyleSpecification)[]` — chosen style first, then `positron` URL as fallback; unknown id → `[positron]`; `'light'` → `[positron]` (no duplicate).
  - `useMapSkin(): [MapSkin, (s: MapSkin) => void]` — localStorage key `lastmile.mapSkin`, try/catch around storage, default `'light'`.
  - `MapViewProps.skin: MapSkin`; `MapKey` props add `skin` and `onSkin`.

- [ ] **Step 1: Write failing tests** `tests/map-skins.test.ts`:

```ts
const POSITRON = 'https://tiles.openfreemap.org/styles/positron';
it('satellite is an inline raster style with attribution, then falls back to light', () => {
  const [sat, fallback] = skinStyles('satellite');
  expect(fallback).toBe(POSITRON);
  expect(typeof sat).toBe('object');
  const src = Object.values((sat as StyleSpecification).sources)[0] as RasterSourceSpecification;
  expect(src.type).toBe('raster');
  expect(src.tiles?.[0]).toContain('World_Imagery/MapServer/tile/{z}/{y}/{x}');
  expect(src.attribution).toMatch(/Esri/);
});
it('maps vector skins to OpenFreeMap and ignores unknown ids', () => {
  expect(skinStyles('dark')[0]).toBe('https://tiles.openfreemap.org/styles/dark');
  expect(skinStyles('light')).toEqual([POSITRON]);
  expect(skinStyles('nope')).toEqual([POSITRON]);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/map-skins.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `map-skins.ts`.** Satellite style: `{ version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { sat: raster tiles, tileSize 256, maxzoom 19, attribution 'Imagery © Esri, Maxar, Earthstar Geographics' }, labels: raster `Reference/World_Boundaries_and_Places` same host }, layers: [sat, labels] }`. `glyphs` is required: station labels use `Noto Sans` text.
- [ ] **Step 4: Wire `MapView`.** `const styles = useMemo(() => skinStyles(skin), [skin])`; reset `styleIdx`/`loaded` to 0/false when `skin` changes; `key={`${skin}-${styleIdx}`}`; `mapStyle={styles[styleIdx]}`; error fallback uses `styles.length`. Satellite has no symbol layer → `firstSymbolId` stays `undefined` (already handled).
- [ ] **Step 5: `MapKey` skin picker** — `<fieldset>` legend `t('Map style')`, radio per `SKINS`, same radio markup as the crash `MODES` group.
- [ ] **Step 6: Run** `npx vitest run && npm run typecheck` — PASS.
- [ ] **Step 7: Commit** `feat(map): map skins with satellite imagery`

---

### Task 3: Elevators, lifts, ramps and step-free doors drawn on the map

**Files:**
- Create: `src/lib/access-points.ts` (pure, no Next imports; used by the build script)
- Modify: `scripts/build-gtfs.ts:355-392` (facility coords), `:440-457` (keep node coords), `:540-560` (write `access.geojson`)
- Modify: `src/lib/mbta/types.ts:77-86` (`Facility.lat?`, `lon?`, `approx?`)
- Modify: `src/lib/ui/api.ts:74-90` (`MapLayerToggles.access`, `MapFeatureInfo` kind `'access'`)
- Modify: `src/components/MapView.tsx` (source `access`, icons in `addLayerImages`, click → feature info)
- Modify: `src/components/MapKey.tsx` (row `access`, default **on**, plus `ramps` default stays off per Task 1 — the access layer includes MBTA ramps)
- Modify: `src/components/LastMileApp.tsx` (`useStaticFile('/data/access.geojson', layers.access)`, pass `closedFacilityIds` from `status.data?.data.closedFacilityIds`, `MapFeatureCard` branch for `access`)
- Modify: `src/components/StationDetails.tsx:65-130` (wrap lift/escalator list in `<details>` closed by default, summary `t('Elevators and escalators as a list')`)
- Generated: `public/data/access.geojson`, `public/data/facilities.json`
- Test: `tests/access-points.test.ts`

**Interfaces:**
- Produces:
  - `facilityPosition(facilityId: string, edges: { from: string; to: string; facilityId: string | null }[], nodeCoord: (id: string) => LatLon | null, own: LatLon | null, station: LatLon): LatLon & { approx: boolean }` — order: `own` (GTFS `facility_lat/lon`) → midpoint of first edge with this `facilityId` whose both ends have coords (either end if only one) → `station` with `approx: true`.
  - `access.geojson` Point features, properties: `{ id, kind: FacilityType | 'ENTRANCE', name, stationId, approx: boolean, wheelchair?: 0|1|2 }`. Entrances = pathway nodes with `kind === 'entrance'` and coords.
  - `MapLayerToggles.access: boolean` (default `true` — the one optional layer on by default; it is the user's core need).
  - `MapFeatureInfo` adds `{ kind: 'access'; id: string; type: string; name: string; stationId: string; approx: boolean; closed: boolean }`.
  - `MapViewProps.access?: FeatureCollection; closedFacilityIds?: string[]`.

- [ ] **Step 1: Write failing tests** `tests/access-points.test.ts`:

```ts
const station = { lat: 42.35, lon: -71.06 };
const coords: Record<string, LatLon> = { a: { lat: 42.351, lon: -71.061 }, b: { lat: 42.353, lon: -71.063 } };
const nodeCoord = (id: string) => coords[id] ?? null;
it('prefers the GTFS coordinate', () =>
  expect(facilityPosition('e1', [], nodeCoord, { lat: 42.36, lon: -71.07 }, station)).toEqual({ lat: 42.36, lon: -71.07, approx: false }));
it('falls back to the middle of the elevator pathway', () =>
  expect(facilityPosition('e1', [{ from: 'a', to: 'b', facilityId: 'e1' }], nodeCoord, null, station)).toEqual({ lat: 42.352, lon: -71.062, approx: false }));
it('falls back to the station point and says so', () =>
  expect(facilityPosition('e1', [{ from: 'x', to: 'y', facilityId: 'e1' }], nodeCoord, null, station)).toEqual({ ...station, approx: true }));
it('built file has every subway facility and no 0,0 points', () => {
  const fc = JSON.parse(readFileSync('public/data/access.geojson', 'utf8'));
  const fac = JSON.parse(readFileSync('public/data/facilities.json', 'utf8'));
  const ids = new Set(fc.features.map((f: any) => f.properties.id));
  expect(fac.every((f: any) => ids.has(f.id))).toBe(true);
  expect(fc.features.every((f: any) => f.geometry.coordinates[1] > 42)).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/access-points.test.ts` — FAIL.
- [ ] **Step 3: Implement `facilityPosition`** in `src/lib/access-points.ts` (round to 5 dp like `r5`).
- [ ] **Step 4: Build script.** Keep a `stopCoord(id)` lookup from `stops.txt` (all location types, not just entrances). For each `Facility` set `lat/lon/approx` via `facilityPosition` (use the station's `edges` from `pathways`). Write `access.geojson`. Log `access: N facilities (own X, pathway Y, approx Z), M entrances`.
- [ ] **Step 5: Run** `npm run build:data` (downloads ~MBTA GTFS zip into `data/raw/`, gitignored) then `npx vitest run` — PASS. Record the coverage log line in the commit body.
- [ ] **Step 6: Map layer.** Draw-in-code icons in `addMapIcons` (Task 1): `lm-elev` (blue `#1d4ed8` rounded square, white ▲▼), `lm-elev-out` (same shape, red `#b91c1c` fill, white ✕), `lm-esc` / `lm-esc-out` (stairs glyph, same colours), `lm-lift` / `lm-lift-out` (wheelchair glyph on platform), `lm-ramp` / `lm-ramp-out`, `lm-door` (blue door glyph), `lm-door-no` (grey door with bar). Symbol layer `access-points`, `minzoom: 14` (keeps zoomed-out map minimal), `icon-image` = case on `kind` and `['in', ['get','id'], ['literal', closedFacilityIds]]`; `icon-opacity` 0.6 when `approx`. Add `'access-points'` to `FEATURE_LAYER_ORDER` and `interactive`. Escalators use the same icon set with `icon-size` 0.8 (they are not step-free; card says so).
- [ ] **Step 7: Feature card + key.** `MapFeatureCard` for `access`: name, type word (`facilityTypeWord`), `Working` / `Out of service` with `StateIcon`, station button (`selectStation`), and `t('Position is approximate (at the station).')` when `approx`. `MapKey` row: label `t('Elevators, lifts, ramps and step-free doors (zoom in to see them)')`, `LAYER_NOTES.access` explaining red = out of service. Layer summary line: counts of working / out of service.
- [ ] **Step 8: StationDetails** — `<details>` wrapper as listed in Files; default closed.
- [ ] **Step 9: Run** `npx vitest run && npm run typecheck && npm run lint` — PASS.
- [ ] **Step 10: Commit** `feat(map): elevators, lifts and step-free doors on the map with live status`

---

### Task 4: Sign-in required + `profile` on the account

**Files:**
- Create: `src/lib/profile.ts`
- Modify: `src/lib/server/auth.ts:22-32` (field `profile`)
- Modify: `src/app/page.tsx` (server gate)
- Modify: `src/app/login/page.tsx` (signed-in → redirect `/`; copy `Sign in to use LastMile.`)
- Modify: `src/components/Account.tsx` (no signed-out branch; sign-out → `router.replace('/login')`; add link `t('Edit my profile')` → `/welcome`)
- Test: `tests/profile.test.ts`

**Interfaces:**
- Produces (in `src/lib/profile.ts`, relative imports only):
  - `SERVICES = ['transit', 'drive', 'park-ride'] as const`; `type Service`
  - `NEEDS = ['wheelchair', 'stroller', 'walker', 'low-vision', 'hearing', 'none'] as const`; `type Need`
  - `type SavedPlace = { kind: 'home' | 'work' | 'other'; label: string; address: string; lat: number; lon: number }`
  - `type Profile = { service: Service; needs: Need[]; places: SavedPlace[] }`
  - `ProfileSchema` (zod): `label` 1–40 chars trimmed, `address` ≤ 200, lat/lon inside `BOSTON_BBOX` (import `../lib/walk` relatively — `src/lib/walk.ts` has no Next imports), `places` max 10, at most one `home` and one `work`, `needs` deduped max 6.
  - `gateRedirect(session: { user: { profile?: unknown } } | null): '/login' | '/welcome' | null` — null session → `/login`; profile missing or failing `ProfileSchema.safeParse` → `/welcome`; else `null`.
  - Better Auth field: `profile: { type: 'json', required: false, validator: { input: ProfileSchema } }`.

- [ ] **Step 1: Write failing tests** `tests/profile.test.ts`:

```ts
const ok: Profile = { service: 'drive', needs: ['wheelchair'], places: [{ kind: 'home', label: 'Home', address: '1 Beacon St', lat: 42.3585, lon: -71.0608 }] };
it('gates on session and profile', () => {
  expect(gateRedirect(null)).toBe('/login');
  expect(gateRedirect({ user: {} })).toBe('/welcome');
  expect(gateRedirect({ user: { profile: null } })).toBe('/welcome');
  expect(gateRedirect({ user: { profile: { service: 'teleport' } } })).toBe('/welcome');
  expect(gateRedirect({ user: { profile: ok } })).toBeNull();
});
it('rejects places outside Boston and duplicate homes', () => {
  expect(ProfileSchema.safeParse({ ...ok, places: [{ ...ok.places[0], lat: 40.7 }] }).success).toBe(false);
  expect(ProfileSchema.safeParse({ ...ok, places: [ok.places[0], ok.places[0]] }).success).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/profile.test.ts` — FAIL.
- [ ] **Step 3: Implement `profile.ts`** and add the auth field.
- [ ] **Step 4: Run** `npm run db:migrate` (needs `DATABASE_URL` in `.env.local`) — expect a new `profile` column on `user`. If the DB is unreachable, stop and tell the user; do not fake it.
- [ ] **Step 5: Gate `page.tsx`.** Async server component: `const session = await auth.api.getSession({ headers: await headers() })`; `const to = gateRedirect(session); if (to) redirect(to);` then `<LastMileApp profile={session.user.profile as Profile} />`. Read `node_modules/next/dist/docs/01-app/02-guides/authentication.md` first for the Next 16 `redirect`/`headers` signatures. APIs under `/api/*` stay public (MCP server, notify cron and the map read them; data is public MBTA/City data) — only pages are gated.
- [ ] **Step 6: Login + Account** changes as listed in Files.
- [ ] **Step 7: Run** `npx vitest run && npm run typecheck` — PASS.
- [ ] **Step 8: Commit** `feat(auth): require sign-in and store onboarding profile on the account`

---

### Task 5: Address search API (`/api/geocode`)

**Files:**
- Create: `src/lib/geocode.ts`
- Create: `src/app/api/geocode/route.ts`
- Test: `tests/geocode.test.ts`

**Interfaces:**
- Consumes: `FetchLike`, `BOSTON_BBOX`, `LatLon` from `src/lib/walk.ts`.
- Produces:
  - `type GeoHit = { label: string; lat: number; lon: number }`
  - `geocode(q: string, deps?: { fetch?: FetchLike; noCache?: boolean }): Promise<GeoHit[]>` — never throws; `[]` on upstream error. URL: `search?format=jsonv2&limit=5&countrycodes=us&bounded=1&viewbox=-71.4,42.6,-70.8,42.1&q=<encoded>`. Drops hits outside `BOSTON_BBOX`. `label` = first three comma parts of `display_name`. Cache 24 h, 500 entries, key = lowercased trimmed `q`.
  - `GET /api/geocode?q=` → `{ data: GeoHit[] }`; `q` trimmed length 3–200 else 400 `{ error }`. Requires a session (`auth.api.getSession`) else 401 — keeps the shared Nominatim quota for signed-in users.

- [ ] **Step 1: Write failing tests** `tests/geocode.test.ts` with an injected fetch:

```ts
it('returns Boston hits with short labels', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => [
    { display_name: 'One Beacon Street, 1, Beacon Street, Government Center, Boston, MA', lat: '42.3584577', lon: '-71.0608383' },
    { display_name: 'Somewhere, NY', lat: '40.7', lon: '-74.0' },
  ] });
  expect(await geocode('1 Beacon St', { fetch, noCache: true })).toEqual([
    { label: 'One Beacon Street, 1, Beacon Street', lat: 42.35846, lon: -71.06084 },
  ]);
});
it('returns [] when the upstream fails', async () => {
  const fetch = async () => { throw new Error('down'); };
  expect(await geocode('anything', { fetch, noCache: true })).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/geocode.test.ts` — FAIL.
- [ ] **Step 3: Implement** `geocode.ts` and the route (mirror `src/app/api/walk/route.ts`; `Cache-Control: private, max-age=3600`).
- [ ] **Step 4: Run** `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `feat(api): address search for saved places`

---

### Task 6: Onboarding at `/welcome`

**Files:**
- Create: `src/app/welcome/page.tsx` (server: session required else `redirect('/login')`; passes current `profile` or null)
- Create: `src/app/welcome/WelcomeForm.tsx` (client)
- Modify: `src/lib/ui/auth-client.ts` only if `inferAdditionalFields` does not type `profile`

**Interfaces:**
- Consumes: `Profile`, `ProfileSchema`, `SERVICES`, `NEEDS`, `SavedPlace` (Task 4); `GET /api/geocode` (Task 5); `authClient.updateUser`.
- Produces: page saving `authClient.updateUser({ profile })` then `router.replace('/')`.

Copy (exact, English keys for `t()`):
- Step 1 heading `How will you travel most?` — options `MBTA subway (step-free routes)` / `My own car` / `Car to a station, then the T (park & ride)`. Required.
- Step 2 heading `What should we plan around?` (checkboxes, optional) — `Wheelchair or scooter`, `Stroller`, `Cane, walker or limited walking`, `Low vision`, `Deaf or hard of hearing`, `None of these`. `None of these` clears the others.
- Step 3 heading `Save your places` — rows Home, Work, `Other place` (+ `Add another place`, up to 10). Each row: text input `Address`, button `Search`, result radio list (`aria-live="polite"`), and for Other a `Name` input. Empty rows are skipped. `Skip for now` allowed.
- Final button `Save and start`; errors via `<Notice tone="error">`.

- [ ] **Step 1: Implement the page and form.** One component, a `step` state 1–3, `Back` / `Next` buttons, focus moves to each step heading (`tabIndex={-1}` + `ref.focus()`). Validate with `ProfileSchema.safeParse` before `updateUser`; show the first zod issue message on failure.
- [ ] **Step 2: Verify in browser** (dev server via preview tools): new account → lands on `/welcome`; complete all steps → lands on `/`; reload `/` stays; sign out → `/login`; `/welcome` while signed out → `/login`. Re-open `/welcome` from `Edit my profile` → answers prefilled.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint` — PASS.
- [ ] **Step 4: Commit** `feat(onboarding): ask main service, access needs and saved places after sign-in`

---

### Task 7: Use the profile in the app

**Files:**
- Modify: `src/components/LastMileApp.tsx` (prop `profile: Profile`; default tab; pass places)
- Modify: `src/components/TripPlanner.tsx:56-64, 140-190, 270-300` (saved places as start and destination)
- Test: `tests/profile.test.ts` (add `defaultTab`)

**Interfaces:**
- Consumes: `Profile` (Task 4).
- Produces: `defaultTab(p: Profile): 'trip' | 'drive'` in `src/lib/profile.ts` (`transit` → `trip`, else `drive`); `TripPlanner` prop `places: SavedPlace[]`; new `StartMode` `'saved'` (label `A saved place`, shown only when `places.length`), with a select of saved labels that calls the existing `setStartPlace`.

- [ ] **Step 1: Write failing test** — `expect(defaultTab({ ...ok, service: 'transit' })).toBe('trip'); expect(defaultTab(ok)).toBe('drive');`
- [ ] **Step 2: Run** `npx vitest run tests/profile.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `Tabs.tsx` hides every panel for an unknown id, so set `useState('trip')` here (not `'broken'`) and switch to `useState(defaultTab(profile))` in Task 8 Step 5, when the `drive` tab exists. Destination `Place` select lists saved places first (`optgroup` `Your places`), then `DEMO_DESTINATIONS` (`optgroup` `Examples`). Needs including `wheelchair` or `walker` turn `layers.ramps` on at start.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(app): saved places and main service drive the planner`

---

### Task 8: Drive and park & ride

**Files:**
- Modify: `src/lib/walk.ts:113-141, 163-218` (car profile)
- Create: `src/lib/drive.ts`
- Create: `src/app/api/drive/route.ts`
- Create: `src/components/DrivePlanner.tsx`
- Modify: `src/lib/ui/hooks.ts` (`useDrive`)
- Modify: `src/components/LastMileApp.tsx` (tab `drive`, drive line, `onPlanTrain`)
- Modify: `src/components/TripPlanner.tsx` (prop `presetFrom?: { id: string; seq: number }` → `setFrom(id)` in an effect)
- Modify: `src/components/MapView.tsx` (source `drive`: solid `#0f172a` 5px line on 8px white casing; accessible parking symbol `lm-parking` ♿P at lots with `accessibleSpaces > 0`, minzoom 12)
- Test: `tests/drive.test.ts`

**Interfaces:**
- Consumes: `LatLon`, `FetchLike`, `WalkResult`, `haversineM` (walk.ts); `ParkingLot` (`public/data/parking.json`, 32 lots with `accessibleSpaces`, `lat`, `lon`); `SavedPlace` (Task 4).
- Produces:
  - `walk.ts`: `export const OSRM_CAR_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving'`; `fromOsrm(from, to, deps = {}, profile: 'foot' | 'car' = 'foot')` — car skips the wheelchair-pace adjustment; export `getJson`.
  - `drive.ts`: `type DriveResult = Omit<WalkResult, 'source' | 'warnings'> & { source: 'osrm' | 'straight' }`; `getDrive(from: LatLon, to: LatLon, deps?: WalkDeps): Promise<{ result: DriveResult; fromCache: boolean; fetchedAt: number }>` (OSRM car → straight line at 8 m/s marked `approximate`; own cache, key prefix `car:`); `accessibleParkingNear(to: LatLon, lots: ParkingLot[], radiusM = 1500): (ParkingLot & { distanceM: number })[]` — only `accessibleSpaces > 0`, sorted by distance.
  - `GET /api/drive?from=lat,lon&to=lat,lon` → `ApiEnvelope<DriveResult & { parking: (ParkingLot & { distanceM: number })[] }>`; 400 on bad coords (reuse `parseLatLon` message).
  - `DrivePlanner` props `{ stations: Station[]; places: SavedPlace[]; onDrive: (coords: [number, number][] | null) => void; onPlanTrain: (stationId: string) => void }`.

DrivePlanner UI (copy exact):
- Heading `Drive`. Start: `My location` / `A saved place` / `Pretend I'm at Park Street (demo)` (reuse `getMyLocation`, `DEMO_PLACE`).
- Radio `Drive all the way` / `Park at a station and take the T`.
- All the way: destination select = saved places + `DEMO_DESTINATIONS`. Result: distance, minutes, turn list, then `Accessible parking near {place}` (MBTA lots only) or `No MBTA lots with accessible spaces near here. Check street parking signs on arrival.`
- Park & ride: select of stations that have a lot with `accessibleSpaces > 0` — `{station} — {n} accessible spaces`. Result: drive to the lot's coordinates, then button `Plan the step-free train from {station}` → `onPlanTrain(stationId)` (app switches to `trip` tab, sets `presetFrom`).
- Footer note: `Driving times are estimates without live traffic.`

- [ ] **Step 1: Write failing tests** `tests/drive.test.ts`:

```ts
it('uses the car profile URL and keeps OSRM time', async () => {
  let called = '';
  const fetch = async (u: string) => { called = u; return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 4369, duration: 467, geometry: { coordinates: [[-71.0621, 42.3564], [-71.0972, 42.3467]] }, legs: [{ steps: [] }] }] }) }; };
  const { result } = await getDrive({ lat: 42.3564, lon: -71.0621 }, { lat: 42.3467, lon: -71.0972 }, { fetch, noCache: true });
  expect(called.startsWith(OSRM_CAR_URL)).toBe(true);
  expect(result.source).toBe('osrm');
  expect(result.minutes).toBeCloseTo(467 / 60, 1);
});
it('falls back to a straight line when OSRM is down', async () => {
  const fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const { result } = await getDrive({ lat: 42.3564, lon: -71.0621 }, { lat: 42.3467, lon: -71.0972 }, { fetch, noCache: true });
  expect(result.source).toBe('straight');
  expect(result.approximate).toBe(true);
});
it('lists only lots with accessible spaces, nearest first', () => {
  const lots = [
    { id: 'a', stationId: 's', name: 'A', capacity: 10, accessibleSpaces: 0, lat: 42.35, lon: -71.06 },
    { id: 'b', stationId: 's', name: 'B', capacity: 10, accessibleSpaces: 2, lat: 42.355, lon: -71.06 },
    { id: 'c', stationId: 's', name: 'C', capacity: 10, accessibleSpaces: 3, lat: 42.351, lon: -71.06 },
  ];
  expect(accessibleParkingNear({ lat: 42.35, lon: -71.06 }, lots).map((l) => l.id)).toEqual(['c', 'b']);
});
```
Also re-run `tests/walk.test.ts` — the foot path must not change.

- [ ] **Step 2: Run** `npx vitest run tests/drive.test.ts` — FAIL.
- [ ] **Step 3: Implement** walk.ts changes, `drive.ts`, `/api/drive` (mirror `/api/walk`, no warnings).
- [ ] **Step 4: Run** `npx vitest run` — PASS (incl. `walk.test.ts`).
- [ ] **Step 5: UI.** `useDrive(from, to)` in hooks.ts (SWR, key null until both set). `DrivePlanner.tsx` as specified; keep under 300 lines. App: Drive tab between `Plan a trip` and `Crash spots`; initial tab now `defaultTab(profile)`; `driveLines` state → `MapClient drive` prop; parking FC from `useStaticFile('/data/parking.json', tab === 'drive')`.
- [ ] **Step 6: Run** `npx vitest run && npm run typecheck && npm run lint` — PASS.
- [ ] **Step 7: Commit** `feat(drive): driving and park & ride with accessible parking`

---

### Task 9: End-to-end check in the browser

- [ ] **Step 1:** Start dev server with preview tools (`.claude/launch.json`, `npm run dev`, port 3000).
- [ ] **Step 2:** Signed out: `/` → `/login`. Sign up a test account (record test email in `.env.local` comment, not in chat) → `/welcome` → choose `My own car`, `Wheelchair or scooter`, Home = `1 Beacon St` → `/` opens on Drive tab.
- [ ] **Step 3:** Map at load: only purple ≥0.5 crash dots, stations and lines; no trains / fatal rings. Zoom to Park Street (≥14): elevator and door icons visible; click one → card with Working/Out of service. Switch skins Light → Satellite → Dark: overlays stay, no "map could not load".
- [ ] **Step 4:** Drive from Home to Fenway Park → dark line on map + turn list. Park & ride to Alewife → `Plan the step-free train from Alewife` → Trip tab with Alewife preselected.
- [ ] **Step 5:** `read_console_messages` onlyErrors → none. Screenshot for the user.
- [ ] **Step 6:** `npm test && npm run typecheck && npm run lint && npm run build` — all green.
