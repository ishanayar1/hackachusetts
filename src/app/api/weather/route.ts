// GET /api/weather?lat=<lat>&lon=<lon> -> ApiEnvelope<WeatherNow>
// Current hour from weather.gov plus active NWS alerts (src/lib/weather.ts). 503 when unavailable:
// the UI hides the weather box.
import { connection } from 'next/server';
import type { ApiEnvelope } from '@/lib/mbta/types';
import { getWeather, type WeatherNow } from '@/lib/weather';
import { parseLatLon } from '@/lib/walk';

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const point = parseLatLon(`${params.get('lat') ?? ''},${params.get('lon') ?? ''}`);
  if (!point) {
    return Response.json(
      { error: 'lat and lon must be inside Greater Boston (lat 42.1 to 42.6, lon -71.4 to -70.8)' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const { data, fromCache, fetchedAt } = await getWeather(point.lat, point.lon);
    const body: ApiEnvelope<WeatherNow> = {
      data,
      source: fromCache ? 'cache' : 'v3',
      ageSec: Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)),
      fetchedAt: new Date(fetchedAt).toISOString(),
    };
    return Response.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600' },
    });
  } catch {
    return Response.json(
      { error: 'Weather temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
