// Predictions + vehicles normalization. Pure functions, no I/O.
import { SUBWAY_ROUTES, type Prediction, type Vehicle } from './types';
import { identityParent, type ParentOf } from './alerts';

const SUBWAY = new Set<string>(SUBWAY_ROUTES);
export const STOP_ID_RE = /^place-[a-z0-9-]+$/;
export const MAX_PREDICTION_STOPS = 5;
export const PREDICTIONS_PER_GROUP = 3;

/** A vehicle whose position is older than this is flagged stale. */
export const VEHICLE_STALE_MS = 5 * 60_000;

/** Subway only (route_type 0,1): filter[stop]=place-sstat would otherwise pull in Silver Line and Commuter Rail. */
export function predictionsPath(stopIds: string[]): string {
  return `/predictions?filter[stop]=${stopIds.join(',')}&filter[route_type]=0,1&include=trip,stop&fields[trip]=headsign&sort=departure_time`;
}

export const VEHICLES_PATH = `/vehicles?filter[route]=${SUBWAY_ROUTES.join(',')}&include=trip&fields[trip]=headsign`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function relId(row: any, name: string): string | undefined {
  const id = row?.relationships?.[name]?.data?.id;
  return id == null ? undefined : String(id);
}

function indexIncluded(json: any): { headsign: Map<string, string>; stopParent: Map<string, string> } {
  const headsign = new Map<string, string>();
  const stopParent = new Map<string, string>();
  for (const inc of Array.isArray(json?.included) ? json.included : []) {
    if (inc?.type === 'trip' && inc.attributes?.headsign) headsign.set(String(inc.id), inc.attributes.headsign);
    if (inc?.type === 'stop') {
      const parent = relId(inc, 'parent_station');
      if (parent) stopParent.set(String(inc.id), parent);
    }
  }
  return { headsign, stopParent };
}

function resolveStation(stopId: string, parentOf: ParentOf, stopParent: Map<string, string>): string | null {
  if (stopId.startsWith('place-')) return stopId;
  const p = stopParent.get(stopId) ?? parentOf(stopId);
  return p && p.startsWith('place-') ? p : null;
}

function dir(v: unknown): 0 | 1 {
  return v === 1 ? 1 : 0;
}

export function normalizePredictions(json: any, now: Date = new Date(), parentOf: ParentOf = identityParent): Prediction[] {
  const { headsign, stopParent } = indexIncluded(json);
  const nowMs = now.getTime();
  const rows: Prediction[] = [];
  for (const row of Array.isArray(json?.data) ? json.data : []) {
    const a = row?.attributes ?? {};
    if (a.schedule_relationship === 'CANCELLED' || a.schedule_relationship === 'SKIPPED') continue;
    // Departures board: a row with no departure_time is a train ending here (cannot board). Terminal
    // departures have departure_time and a null arrival_time, so they stay.
    const time: string | null = a.departure_time ?? null;
    if (!time) continue;
    const t = Date.parse(time);
    if (Number.isNaN(t) || t < nowMs) continue;
    const routeId = relId(row, 'route');
    const platformId = relId(row, 'stop');
    if (!routeId || !platformId || !SUBWAY.has(routeId)) continue;
    const tripId = relId(row, 'trip');
    const uncertainty = a.arrival_uncertainty ?? a.departure_uncertainty;
    rows.push({
      routeId,
      directionId: dir(a.direction_id),
      headsign: (tripId && headsign.get(tripId)) || a.trip_headsign || null,
      platformId,
      stationId: resolveStation(platformId, parentOf, stopParent) ?? platformId,
      time,
      minutesAway: Math.max(0, Math.floor((t - nowMs) / 60000)),
      approximate: (typeof uncertainty === 'number' && uncertainty >= 360) || a.update_type === 'REVERSE_TRIP',
    });
  }
  rows.sort((x, y) => Date.parse(x.time) - Date.parse(y.time));
  const counts = new Map<string, number>();
  return rows.filter((p) => {
    const k = `${p.stationId}|${p.routeId}|${p.directionId}`;
    const n = counts.get(k) ?? 0;
    counts.set(k, n + 1);
    return n < PREDICTIONS_PER_GROUP;
  });
}

/** Latest updated_at in a raw vehicles body (a demo snapshot's capture time), or null. */
export function latestVehicleUpdate(json: any): Date | null {
  let max = NaN;
  for (const row of Array.isArray(json?.data) ? json.data : []) {
    const t = Date.parse(row?.attributes?.updated_at ?? '');
    if (!Number.isNaN(t) && !(t <= max)) max = t;
  }
  return Number.isNaN(max) ? null : new Date(max);
}

/** `now` is the reference for `stale` (updated_at older than VEHICLE_STALE_MS). */
export function normalizeVehicles(json: any, parentOf: ParentOf = identityParent, now: Date = new Date()): Vehicle[] {
  const { headsign, stopParent } = indexIncluded(json);
  const nowMs = now.getTime();
  const out: Vehicle[] = [];
  for (const row of Array.isArray(json?.data) ? json.data : []) {
    const a = row?.attributes ?? {};
    const routeId = relId(row, 'route');
    if (!routeId || !SUBWAY.has(routeId)) continue;
    const revenue = a.revenue ?? a.revenue_status;
    if (revenue === 'NON_REVENUE') continue;
    if (typeof a.latitude !== 'number' || typeof a.longitude !== 'number') continue;
    const stopId = relId(row, 'stop');
    const tripId = relId(row, 'trip');
    const updatedMs = Date.parse(a.updated_at ?? '');
    out.push({
      id: String(row.id),
      routeId,
      directionId: dir(a.direction_id),
      lat: a.latitude,
      lon: a.longitude,
      bearing: typeof a.bearing === 'number' ? a.bearing : null,
      status: a.current_status ?? 'IN_TRANSIT_TO',
      stationId: stopId ? resolveStation(stopId, parentOf, stopParent) : null,
      headsign: (tripId && headsign.get(tripId)) || null,
      updatedAt: a.updated_at ?? '',
      stale: !Number.isNaN(updatedMs) && nowMs - updatedMs > VEHICLE_STALE_MS,
    });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
