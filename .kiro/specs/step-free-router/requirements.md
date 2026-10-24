# Requirements: Step-free router

> Written to match the code in `src/lib/router.ts` as merged on `main` (commit 788d98d).

## Introduction

Riders who cannot use stairs need a subway trip that only uses step-free paths: from a
street entrance to a platform, between platforms when changing lines, and from the last
platform to a street exit. Elevators, ramps and lifts break often, so the route must
avoid any facility that live MBTA alerts (or the demo "break an elevator" control) mark
as closed. When no step-free trip exists, the rider needs the nearest stations that are
step-free right now.

## Requirements

### Requirement 1: Only step-free paths

**User Story:** As a wheelchair user, I want every part of my route to avoid stairs and
escalators, so that I never reach a point I cannot pass.

#### Acceptance Criteria

1. WHEN the router evaluates an in-station pathway THEN the system SHALL reject pathways whose GTFS mode is stairs (2) or escalator (4).
2. WHEN a pathway is tied to a facility id that is in the closed set THEN the system SHALL reject that pathway.
3. WHEN the router returns a route THEN `usedFacilityIds` SHALL contain no facility from the closed set.
4. WHEN the route starts or ends at a station with pathway data THEN the system SHALL confirm a step-free path from a step-free entrance to the boarding platform, and from the alighting platform to a step-free exit.
5. WHEN the route changes platforms inside a station THEN the system SHALL confirm a step-free path between the two platforms with closures applied.

### Requirement 2: Closures from live alerts and the demo control

**User Story:** As a rider, I want the route to change when an elevator breaks, so that
I am not sent to a broken elevator.

#### Acceptance Criteria

1. WHEN `/api/route` or the MCP tool `plan_step_free_route` plans a trip THEN the system SHALL treat every facility in the live `closedFacilityIds` as closed.
2. WHEN the request includes `closed=id1,id2` THEN the system SHALL add those ids to the closed set.
3. IF `closed` holds more than 50 ids or any id fails `FACILITY_ID_RE` THEN the system SHALL respond 400 without planning.
4. WHEN a request includes `closed` THEN the response SHALL be sent with `Cache-Control: private, no-store`.
5. WHEN more facilities are closed THEN the best route SHALL never get faster.

### Requirement 3: Clear failure with alternatives

**User Story:** As a rider whose station is not step-free right now, I want to see the
nearest stations that are, so that I can change my plan.

#### Acceptance Criteria

1. IF the origin or destination id is unknown THEN the system SHALL return `ok: false`, reason `unknown-station`.
2. IF no platform at the origin is reachable step-free THEN the system SHALL return reason `origin-not-step-free`.
3. IF no platform at the destination is reachable step-free THEN the system SHALL return reason `destination-not-step-free`.
4. IF both ends are step-free but no path connects them THEN the system SHALL return reason `no-path`.
5. WHEN the system returns a failure THEN it SHALL list at most 3 alternative stations that are step-free right now, nearest first, excluding the origin and destination.

### Requirement 4: Honest output

**User Story:** As a rider, I want to know how confident the route is, so that I can
check before I travel.

#### Acceptance Criteria

1. WHEN a station on the trip has no pathway data THEN the system SHALL fall back to its GTFS `wheelchair_boarding` flag and set `approximate: true`.
2. WHEN pathway data exists THEN the system SHALL return the step-free entrance to use (`originEntranceId`) and exit (`destinationExitId`).
3. WHEN origin equals destination and the station is step-free THEN the system SHALL return `ok: true` with no legs and 0 minutes.
4. WHEN a station is not step-free THEN `stationStatus().blockedBy` SHALL list only closed facilities of that station whose reopening restores access.
