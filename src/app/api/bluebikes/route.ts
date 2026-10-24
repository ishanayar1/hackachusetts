// GET /api/bluebikes?lat=<lat>&lon=<lon>&radius=400 -> ApiEnvelope<{ stations: BikeStation[] }>
// Nearest 3 installed Bluebikes stations within the radius (src/lib/bluebikes.ts). 503 when GBFS is down.
import { connection } from 'next/server';
import type { ApiEnvelope } from '@/lib/mbta/types';
import { getNearbyBikes, parseRadius, type BikeStation } from '@/lib/bluebikes';
import { parseLatLon } from '@/lib/walk';

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const point = parseLatLon(`${params.get('lat') ?? ''},${params.get('lon') ?? ''}`);
  const radius = parseRadius(params.get('radius'));
  if (!point || radius === null) {
    return Response.json(
      {
        error:
          'lat and lon must be inside Greater Boston (lat 42.1 to 42.6, lon -71.4 to -70.8); radius is meters (50 to 2000, default 400)',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const { stations, fromCache, fetchedAt } = await getNearbyBikes(point, radius);
    const body: ApiEnvelope<{ stations: BikeStation[] }> = {
      data: { stations },
      source: fromCache ? 'cache' : 'v3',
      ageSec: Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)),
      fetchedAt: new Date(fetchedAt).toISOString(),
    };
    return Response.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
    });
  } catch {
    return Response.json(
      { error: 'Bluebikes temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
