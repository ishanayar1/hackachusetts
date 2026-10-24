// Shared contract for the MBTA data layer.
// Static files are built by scripts/build-gtfs.ts into public/data/ and served at /data/*.json.
// Live data comes from src/lib/mbta/client.ts through the /api/* route handlers.

/** Subway scope. Silver Line is filed as bus (route_type 3) and is out of scope. */
export const SUBWAY_ROUTES = ['Red', 'Orange', 'Blue', 'Green-B', 'Green-C', 'Green-D', 'Green-E', 'Mattapan'] as const;
export type RouteId = (typeof SUBWAY_ROUTES)[number];

/** GTFS wheelchair_boarding: 0 = no info, 1 = accessible, 2 = not accessible. */
export type Wheelchair = 0 | 1 | 2;

// ---------- static: public/data/stations.json -> Station[] ----------
export interface Station {
  id: string; // parent station id, e.g. "place-pktrm"
  name: string;
  lat: number;
  lon: number;
  wheelchair: Wheelchair; // the parent station's own flag
  routes: RouteId[];
  platformIds: string[]; // child platforms (location_type 0) served by subway routes
  entranceIds: string[]; // child entrances (location_type 2, "door-*")
  facilityIds: string[]; // elevators, escalators, ramps, lifts at this station
}

// ---------- static: public/data/network.json -> Network ----------
export interface Platform {
  id: string; // GTFS stop_id of the platform
  stationId: string;
  name: string; // platform_name, e.g. "Alewife"
  routes: RouteId[];
}
/** One hop between consecutive platforms on a canonical route pattern. Directed. */
export interface RideEdge {
  from: string; // platform id
  to: string; // platform id
  route: RouteId;
  directionId: 0 | 1;
  minutes: number; // scheduled run time of the representative trip, >= 0.5
}
export interface Network {
  platforms: Record<string, Platform>;
  rides: RideEdge[];
}

// ---------- static: public/data/pathways.json -> Record<stationId, StationPathways> ----------
/** pathway_mode: 1 walkway, 2 stairs, 3 moving sidewalk, 4 escalator, 5 elevator, 6 fare gate, 7 exit gate. */
export type PathwayMode = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type NodeKind = 'platform' | 'entrance' | 'node' | 'station';
export interface PathwayNode {
  kind: NodeKind;
  wheelchair: Wheelchair; // entrances carry their own flag
  name?: string;
}
/** Directed edge. Bidirectional GTFS rows are expanded into two edges at build time. */
export interface PathwayEdge {
  from: string;
  to: string;
  mode: PathwayMode;
  facilityId: string | null; // set for elevators (and escalators) that alerts can close
  seconds: number; // wheelchair_traversal_time ?? traversal_time ?? estimate
}
export interface StationPathways {
  nodes: Record<string, PathwayNode>;
  edges: PathwayEdge[];
}

// ---------- static: public/data/facilities.json -> Facility[] ----------
export type FacilityType = 'ELEVATOR' | 'ESCALATOR' | 'RAMP' | 'PORTABLE_BOARDING_LIFT' | 'BRIDGE_PLATE';
export interface Facility {
  id: string; // same id in alerts informed_entity.facility, /facilities and GTFS
  type: FacilityType;
  stationId: string;
  name: string; // long_name
  shortName?: string;
  alternateServiceText?: string; // facilities_properties "alternate-service-text"
  excludesStops?: string[]; // facilities_properties "excludes-stop"
}

// ---------- static: public/data/parking.json -> ParkingLot[] (subway-served lots only) ----------
export interface ParkingLot {
  id: string;
  stationId: string;
  name: string;
  capacity: number | null;
  accessibleSpaces: number | null; // "capacity-accessible"
  feeDaily?: string;
  paymentApp?: string;
  overnightAllowed?: string;
  lat?: number;
  lon?: number;
}

// ---------- static: public/data/lines.geojson -> GeoJSON FeatureCollection ----------
// Feature properties: { route: RouteId, color: "#DA291C" }, geometry: LineString (lon, lat).

// ---------- live: normalized alert ----------
export interface NormalizedAlert {
  id: string;
  effect: string; // e.g. ELEVATOR_CLOSURE, ESCALATOR_CLOSURE, ACCESS_ISSUE, SHUTTLE, SUSPENSION
  header: string;
  shortHeader: string; // falls back to header when MBTA sends ""
  description: string | null;
  url: string | null;
  severity: number; // 0-10
  lifecycle: string; // NEW | ONGOING | UPCOMING | ONGOING_UPCOMING
  activePeriods: { start: string; end: string | null }[];
  activeNow: boolean;
  stationIds: string[]; // parent "place-*" ids (platform ids mapped to parents), deduped
  routeIds: string[];
  facilityIds: string[];
  activities: string[];
  updatedAt: string;
}

// ---------- live: predictions and vehicles ----------
export interface Prediction {
  routeId: string;
  directionId: 0 | 1;
  headsign: string | null; // from the included trip
  platformId: string;
  stationId: string;
  time: string; // ISO, departure_time ?? arrival_time
  minutesAway: number; // rounded down, >= 0
  approximate: boolean; // arrival_uncertainty >= 360 or update_type REVERSE_TRIP
}
export interface Vehicle {
  id: string;
  routeId: string;
  directionId: 0 | 1;
  lat: number;
  lon: number;
  bearing: number | null;
  status: string; // STOPPED_AT | INCOMING_AT | IN_TRANSIT_TO
  stationId: string | null; // parent of the current stop
  headsign: string | null;
  updatedAt: string;
}

// ---------- API envelope returned by every /api/* route ----------
export type DataSource = 'v3' | 'cache' | 'demo';
export interface ApiEnvelope<T> {
  data: T;
  source: DataSource;
  ageSec: number; // seconds since the data was fetched from upstream
  fetchedAt: string; // ISO
}
