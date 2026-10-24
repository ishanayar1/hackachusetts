# Requirements: Recorded crash layer

> Written to match the code in `src/lib/crash.ts`, `src/app/api/crash/locations/` and the crash components as merged on `main` (commit 788d98d).

## Introduction

Riders walking to and from a station want to know where pedestrian and bike crashes
have been recorded. Boston Vision Zero data is historical (2015 to Aug 2026), has no
severity or victim type, and mostly reflects busy streets, so the layer must be labelled
as recorded history and never as a safety rating. The data is precomputed into
`public/data/crash-risk.geojson` (H3 cells from `crash-risk/`), so nothing on this layer
calls an outside service at runtime.

## Requirements

### Requirement 1: Parse precomputed crash areas safely

**User Story:** As the server, I need clean crash areas from the GeoJSON file, so that
bad rows never reach the UI.

#### Acceptance Criteria

1. WHEN a feature has no `hex` id or has invalid or out-of-range coordinates THEN the system SHALL skip it.
2. WHEN a count is missing, negative or non-numeric THEN the system SHALL treat it as 0.
3. WHEN a label is missing or blank THEN the system SHALL use "Unknown location".
4. `total` SHALL be at least `ped + bike + mv`.
5. IF the input is not a FeatureCollection THEN the system SHALL return an empty list.

### Requirement 2: Search and sort crash areas

**User Story:** As a rider, I want to search crash areas by place name and see the ones
with the most recorded pedestrian and bike crashes first.

#### Acceptance Criteria

1. WHEN `q` is given THEN the system SHALL filter labels by case-insensitive substring.
2. WHEN `sort` is `recorded` (the default) THEN the system SHALL order by pedestrian + bike crashes, then total, then hex id.
3. WHEN `sort` is `model` THEN the system SHALL order by the team model's yearly estimate, then as for `recorded`.
4. The response SHALL include `count`, the number of matches before the limit.
5. The system SHALL NOT mutate the loaded data when sorting.

### Requirement 3: Validate the query

**User Story:** As the API, I must reject bad input at the boundary.

#### Acceptance Criteria

1. IF `q` is longer than 100 characters THEN the system SHALL respond 400.
2. IF `limit` is not an integer from 1 to 200 THEN the system SHALL respond 400; the default is 50.
3. IF `sort` is not `recorded` or `model` THEN the system SHALL respond 400.
4. IF the crash file cannot be read or is empty THEN the system SHALL respond 503 with a generic message.

### Requirement 4: Honest, accessible presentation

**User Story:** As a rider, I want to understand what the crash numbers mean, so that I
am not misled.

#### Acceptance Criteria

1. The layer and list SHALL say "Historical, not live" and name the source (Boston Vision Zero, police-reported).
2. The default view SHALL show recorded pedestrian and bike crashes; the model estimate SHALL appear only when the rider chooses it and SHALL be labelled "Team model".
3. The searchable list SHALL do everything the map layer does, so the map is not required.
4. IF `/api/crash/locations` fails THEN the list SHALL read the static GeoJSON directly.
5. The map key SHALL label bins in text, not color alone.
