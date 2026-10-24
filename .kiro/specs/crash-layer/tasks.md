# Implementation Plan: Recorded crash layer

- [x] 1. Offline crash model and labelled H3 cells
  - `crash-risk/predict.py` → `crash-risk/risk.geojson` → `public/data/crash-risk.geojson`
  - _Requirements: 1.1_

- [x] 2. Pure parsing, search and validation
  - `toCrashSpots`, `queryCrashSpots`, `parseCrashQuery` in `src/lib/crash.ts`
  - _Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.3_

- [x] 3. Server loader with in-memory cache
  - `src/lib/server/crash-data.ts`
  - _Requirements: 3.4_

- [x] 4. `/api/crash/locations` route handler
  - `src/app/api/crash/locations/route.ts`
  - _Requirements: 2.4, 3.1–3.4_

- [x] 5. Map layer, key and list UI
  - `MapView.tsx` crash layers, `MapKey.tsx`, `CrashSpots.tsx`, `HexDetails.tsx`
  - _Requirements: 4.1–4.5_

- [x] 6. Tests
  - `tests/crash.test.ts`
  - _Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.3_

- [ ] 7. "Your walk passes through N high-crash areas" warning on a planned trip
  - Planned in `docs/lastmile-plan.md` (Crash history); not found in `src/` yet
