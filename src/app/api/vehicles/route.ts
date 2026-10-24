// `dynamic` route config is removed under cacheComponents; `await connection()` keeps this request-time.
import { connection } from 'next/server';
import { envelope, getParentOf, jsonWithCache, mbtaGet, normalizeVehicles, unavailable, VEHICLES_PATH } from '@/lib/server/mbta';

export async function GET() {
  await connection();
  try {
    const r = await mbtaGet(VEHICLES_PATH, { ttlMs: 15_000 });
    return jsonWithCache(envelope(normalizeVehicles(r.body, getParentOf()), r), 15, 30);
  } catch {
    return unavailable('Vehicles');
  }
}
