# Requirements: "Broken now" alerts feed

> Written to match the code in `src/lib/mbta/`, `src/app/api/alerts/` and `src/components/BrokenNow.tsx` as merged on `main` (commit 788d98d).

## Introduction

Riders find out an elevator is broken only when they reach it. The feed shows current
MBTA subway alerts, accessibility first, and produces the list of closed facility ids
that the router and station status use. It must survive MBTA outages and the shared
venue rate limit.

## Requirements

### Requirement 1: Never lose elevator alerts

**User Story:** As a wheelchair user, I want every elevator closure in the feed, so that
I can trust an empty list.

#### Acceptance Criteria

1. WHEN the system requests MBTA alerts THEN the request SHALL include `filter[activity]=ALL` and `filter[route_type]=0,1` (`ALERTS_PATH`).
2. WHEN an alert's informed entity names a platform or `door-*` entrance THEN the system SHALL map it to the parent `place-*` station id.
3. WHEN the same alert id appears twice THEN the system SHALL keep one alert and merge its stations, routes, facilities and activities.
4. IF the response body is malformed THEN the system SHALL return an empty list instead of throwing.

### Requirement 2: Closed facility ids

**User Story:** As the router, I need the set of facilities closed right now, so that I
can route around them.

#### Acceptance Criteria

1. WHEN an alert is active now AND its effect is `ELEVATOR_CLOSURE`, `ESCALATOR_CLOSURE`, `ACCESS_ISSUE` or `FACILITY_ISSUE` (or its activities include `USING_WHEELCHAIR`) THEN the system SHALL add its facility ids to `closedFacilityIds`.
2. IF every active period of an alert starts in the future THEN the system SHALL NOT treat it as active.
3. WHEN an alert has no active periods THEN the system SHALL treat it as active unless its lifecycle is `UPCOMING`.
4. `closedFacilityIds` SHALL be deduplicated and sorted.

### Requirement 3: Resilient, cached delivery

**User Story:** As a rider on venue wifi, I want the feed to load even when the MBTA API
is slow or rate-limited.

#### Acceptance Criteria

1. WHEN `/api/alerts` responds THEN the body SHALL be `{ data, source, ageSec, fetchedAt }` with `source` one of `v3`, `cache`, `demo`.
2. WHEN a fresh copy is cached THEN the system SHALL serve it without an upstream call (30 s TTL) and send `If-Modified-Since` on revalidation.
3. WHEN the upstream returns 5xx or times out THEN the system SHALL retry up to 2 times; WHEN it returns 429 THEN the system SHALL stop calling until the reset time; other 4xx SHALL NOT be retried.
4. IF the upstream call fails THEN the system SHALL serve the last good data, then `public/data/demo-alerts.json`, then a 503 with a generic message.
5. The API key SHALL only be sent as the `x-api-key` header from server code and SHALL never be logged.

### Requirement 4: Accessible feed UI

**User Story:** As a rider using a screen reader, I want the feed to work without the
map and announce changes.

#### Acceptance Criteria

1. WHEN the feed renders THEN it SHALL show elevator, escalator and access alerts first, then other subway disruptions.
2. WHEN the "Include escalators" toggle is off THEN the system SHALL hide `ESCALATOR_CLOSURE` alerts from the access section.
3. WHEN the alert count changes THEN the system SHALL announce it in an `aria-live="polite"` region.
4. Each alert SHALL carry an icon and a text effect label, never color alone.
5. WHEN there are no access alerts THEN the system SHALL say so in text.
6. The browser SHALL poll `/api/alerts` every 30 s with SWR.
