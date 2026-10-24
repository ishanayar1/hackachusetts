// Driving route (own car): OSRM car profile -> straight line. Plus MBTA lots with accessible spaces nearby.
// Framework-agnostic: no Next imports. `fetch` is injectable so tests never touch the network.
import type { ParkingLot } from './mbta/types';
import { fromOsrm, haversineM, type LatLon, type WalkDeps, type WalkResult } from './walk';

export type DriveResult = Omit<WalkResult, 'source' | 'warnings'> & { source: 'osrm' | 'straight' };
export type NearbyLot = ParkingLot & { distanceM: number };

const STRAIGHT_MPS = 8; // ~29 km/h city average, only when no road route is available
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STRAIGHT_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { result: DriveResult; fetchedAt: number; expiresAt: number }>();

function straight(from: LatLon, to: LatLon): DriveResult {
  const distanceM = Math.round(haversineM(from, to));
  return {
    source: 'straight',
    distanceM,
    minutes: Math.round((distanceM / STRAIGHT_MPS / 60) * 10) / 10,
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    steps: [{ instruction: 'Road routing is not available right now; this is a straight-line estimate', distanceM }],
    approximate: true,
  };
}

/** OSRM car -> straight line, cached in memory. Never throws. */
export async function getDrive(
  from: LatLon,
  to: LatLon,
  deps: WalkDeps = {},
): Promise<{ result: DriveResult; fromCache: boolean; fetchedAt: number }> {
  const now = deps.now ?? Date.now;
  const key = [from.lat, from.lon, to.lat, to.lon].map((n) => n.toFixed(5)).join(',');
  const hit = deps.noCache ? undefined : cache.get(key);
  if (hit && hit.expiresAt > now()) return { result: hit.result, fromCache: true, fetchedAt: hit.fetchedAt };

  let result: DriveResult;
  try {
    result = { ...(await fromOsrm(from, to, deps, 'car')), source: 'osrm' };
  } catch {
    result = straight(from, to);
  }
  const fetchedAt = now();
  if (!deps.noCache) {
    cache.set(key, { result, fetchedAt, expiresAt: fetchedAt + (result.source === 'straight' ? STRAIGHT_TTL_MS : CACHE_TTL_MS) });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return { result, fromCache: false, fetchedAt };
}

/** MBTA lots with at least one accessible space within radiusM of `to`, nearest first. */
export function accessibleParkingNear(to: LatLon, lots: readonly ParkingLot[], radiusM = 1500): NearbyLot[] {
  return lots
    .filter((l): l is ParkingLot & LatLon => (l.accessibleSpaces ?? 0) > 0 && l.lat !== undefined && l.lon !== undefined)
    .map((l) => ({ ...l, distanceM: Math.round(haversineM(to, l)) }))
    .filter((l) => l.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}
