// Note: `export const dynamic = 'force-dynamic'` is removed in Next 16 when cacheComponents is on
// (next.config.ts). `await connection()` marks this handler as request-time instead.
import { connection } from 'next/server';
import {
  ALERTS_PATH,
  closedFacilityIds,
  envelope,
  getParentOf,
  jsonWithCache,
  loadDemoAlerts,
  mbtaGet,
  normalizeAlerts,
  unavailable,
} from '@/lib/server/mbta';

export async function GET(request: Request) {
  await connection();
  const origin = new URL(request.url).origin;
  try {
    const r = await mbtaGet(ALERTS_PATH, { ttlMs: 30_000, fallback: () => loadDemoAlerts(origin) });
    const now = new Date();
    const alerts = normalizeAlerts(r.body, getParentOf(), now);
    return jsonWithCache(envelope({ alerts, closedFacilityIds: closedFacilityIds(alerts, now) }, r), 30, 60);
  } catch {
    return unavailable('Alerts');
  }
}
