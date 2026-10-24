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
