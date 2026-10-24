// `dynamic` route config is removed under cacheComponents; `await connection()` keeps this request-time.
// Fallback chain: MBTA -> last good (cache) -> public/data/demo-vehicles.json (source 'demo').
// Vehicles whose position is more than 5 minutes old (stale) are left out unless ?stale=1.
import { connection } from 'next/server';
import { latestVehicleUpdate } from '@/lib/mbta/live';
import {
  envelope,
  getParentOf,
  jsonWithCache,
  loadDemoVehicles,
  mbtaGet,
  normalizeVehicles,
  unavailable,
  VEHICLES_PATH,
} from '@/lib/server/mbta';

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const includeStale = url.searchParams.get('stale') === '1';
  try {
    const r = await mbtaGet(VEHICLES_PATH, { ttlMs: 15_000, fallback: () => loadDemoVehicles(url.origin) });
    // A demo snapshot is judged against its own capture time, so it is not all stale.
    const now = (r.source === 'demo' && latestVehicleUpdate(r.body)) || new Date();
    const all = normalizeVehicles(r.body, getParentOf(), now);
    return jsonWithCache(envelope(includeStale ? all : all.filter((v) => !v.stale), r), 15, 30);
  } catch {
    return unavailable('Vehicles');
  }
}
