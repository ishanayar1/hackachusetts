// Client-side API types and the shared SWR fetcher. Mirrors the /api/* contract.
import type { ApiEnvelope, Facility, NormalizedAlert, ParkingLot, Prediction, Station } from '@/lib/mbta/types';
import type { RouteResult, StationStatus } from '@/lib/router';

export type { ApiEnvelope, Facility, NormalizedAlert, ParkingLot, Prediction, Station };

export type AlertsData = { alerts: NormalizedAlert[]; closedFacilityIds: string[] };

/** A platform (direction) that has no step-free path right now, and the facilities that cause it. */
export type BlockedPlatform = { platformId: string; name: string; facilityIds: string[] };

export type StationStatusRow = {
  id: string;
  name: string;
  stepFree: boolean;
  approximate: boolean;
  blockedBy: string[];
  /** Some platform is blocked but at least one works. Optional: older servers do not send it. */
  partial?: boolean;
  blockedPlatforms?: BlockedPlatform[];
};
export type StationsStatusData = { stations: StationStatusRow[]; closedFacilityIds: string[] };

export type StationStatusPlus = StationStatus & { partial?: boolean; blockedPlatforms?: BlockedPlatform[] };

export type StationDetailData = {
  station: Station;
  facilities: (Facility & { closed: boolean })[];
  status: StationStatusPlus;
  parking: ParkingLot[];
  alerts: NormalizedAlert[];
};

export type PlannedRoute = RouteResult & { closedFacilityIds: string[] };

export type CrashSpot = {
  site: string;
  label: string;
  neighborhood: string;
  lat: number;
  lng: number;
  pedBike: number;
  ped: number;
  bike: number;
  mv: number;
  total: number;
  estimatePerYear: number;
};
export type CrashLocationsData = { count: number; results: CrashSpot[] };
/** A crash intersection as shown in the panel. first/last are only known when it came from the map layer. */
export type CrashHex = CrashSpot & { first?: string; last?: string };

/** A live train from /api/vehicles (stale positions are already left out by the server). */
export type { Vehicle } from '@/lib/mbta/types';

/** public/data/fatalities.json row (Boston Vision Zero fatal crashes). */
export type FatalCrash = { id: string; date: string; mode: string; label: string; lat: number; lon: number };
/** public/data/safety-concerns.json row (resident reports; free-text comments are not included). */
export type DangerReport = { id: string; date: string; mode: string; concern: string; lat: number; lon: number };
/** public/data/ramps.json row. condition: 'poor condition' | 'lip at edge' | 'poor condition, lip at edge'. */
export type CurbRamp = { id: string; condition: string; lat: number; lon: number };
/** Properties of a public/data/ej.geojson block group. */
export type EjBlockGroup = {
  geoid: string;
  municipality: string;
  population: number;
  pctMinority: number | null;
  limitedEnglishPct: number | null;
  medianIncome: number | null;
  criteria: string;
};

/** Optional map layers (toggled in the map key). */
export type MapLayerToggles = { trains: boolean; fatal: boolean; danger: boolean; equity: boolean; ramps: boolean };

/** What the user clicked on an optional map layer; shown as text in the panel. */
export type MapFeatureInfo =
  | {
      kind: 'train';
      id: string;
      routeId: string;
      headsign: string | null;
      status: string;
      stationId: string | null;
      updatedAt: string;
    }
  | ({ kind: 'fatal' } & Omit<FatalCrash, 'lat' | 'lon'>)
  | ({ kind: 'danger' } & Omit<DangerReport, 'lat' | 'lon'>)
  | ({ kind: 'ramp' } & Omit<CurbRamp, 'lat' | 'lon'>)
  | ({ kind: 'equity' } & EjBlockGroup);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(res.status, `${url} returned ${res.status}`);
  return (await res.json()) as T;
}
