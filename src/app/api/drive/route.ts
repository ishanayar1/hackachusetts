// GET /api/drive?from=<lat>,<lon>&to=<lat>,<lon> -> ApiEnvelope<DriveResult & { parking: NearbyLot[] }>
// Car route (OSRM car -> straight line, src/lib/drive.ts) plus MBTA lots with accessible spaces near `to`.
import { connection } from 'next/server';
import { accessibleParkingNear, getDrive, type DriveResult, type NearbyLot } from '@/lib/drive';
import type { ApiEnvelope } from '@/lib/mbta/types';
import { getStaticData } from '@/lib/server/static-data';
import { parseLatLon } from '@/lib/walk';

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const from = parseLatLon(params.get('from'));
  const to = parseLatLon(params.get('to'));
  if (!from || !to) {
    return Response.json(
      { error: 'from and to must be "lat,lon" inside Greater Boston (lat 42.1 to 42.6, lon -71.4 to -70.8)' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const { result, fromCache, fetchedAt } = await getDrive(from, to);
  const body: ApiEnvelope<DriveResult & { parking: NearbyLot[] }> = {
    data: { ...result, parking: accessibleParkingNear(to, getStaticData().parking) },
    source: fromCache ? 'cache' : 'v3',
    ageSec: Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)),
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
  const sMaxAge = result.source === 'straight' ? 60 : 21600;
  return Response.json(body, {
    headers: { 'Cache-Control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge}` },
  });
}
