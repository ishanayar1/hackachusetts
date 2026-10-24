// GET /api/crash/locations?q=&limit=50&sort=recorded|model
// Recorded crash history per area (precomputed static data, 2015 to 2026-08). Not live and not a prediction.
// Envelope `source` is 'cache': the data is our stored copy, not an MBTA call; fetchedAt is when this server loaded it.
import { connection } from 'next/server';
import { parseCrashQuery, queryCrashSpots } from '@/lib/crash';
import { getCrashSpots } from '@/lib/server/crash-data';
import { jsonWithCache, unavailable } from '@/lib/server/mbta';

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const parsed = parseCrashQuery(url.searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const { spots, loadedAt } = await getCrashSpots(url.origin);
    const data = queryCrashSpots(spots, parsed.value);
    return jsonWithCache(
      {
        data,
        source: 'cache',
        ageSec: Math.max(0, Math.round((Date.now() - loadedAt) / 1000)),
        fetchedAt: new Date(loadedAt).toISOString(),
      },
      3600,
      86400,
    );
  } catch {
    return unavailable('Crash history');
  }
}
