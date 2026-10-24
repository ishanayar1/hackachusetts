// GET /api/walk?from=<lat>,<lon>&to=<lat>,<lon> -> ApiEnvelope<WalkResult>
// Wheelchair walking route: Valhalla -> OSRM foot -> straight line (src/lib/walk.ts).
import { connection } from 'next/server';
import type { ApiEnvelope } from '@/lib/mbta/types';
import { getWalk, parseLatLon, type WalkResult } from '@/lib/walk';
import { walkWarnings } from '@/lib/warnings';
import { getWarningData } from '@/lib/server/warnings-data';

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

  const { result, fromCache, fetchedAt } = await getWalk(from, to);
  const data: WalkResult = { ...result };

  // Warnings are optional in the contract: a failure here must never break the walk itself.
  try {
    data.warnings = walkWarnings(data.coordinates, getWarningData());
  } catch {
    // leave data.warnings unset
  }

  const body: ApiEnvelope<WalkResult> = {
    data,
    // 'v3' = fetched from upstream on this request (data.source says which router), 'cache' = served from memory.
    source: fromCache ? 'cache' : 'v3',
    ageSec: Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)),
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
  // Straight-line results mean both routers failed: let CDNs keep them only briefly.
  const sMaxAge = result.source === 'straight' ? 60 : 21600;
  return Response.json(body, {
    headers: { 'Cache-Control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge}` },
  });
}
