// GET /api/route?from=place-a&to=place-b&closed=id1,id2
// `closed` adds demo closures (the "break this elevator" button) on top of live alert closures.
import { connection } from 'next/server';
import { getAlertsOrDemo, parseClosedParam, planWithClosures } from '@/lib/lastmile-service';
import { envelope, getParentOf, loadDemoAlerts, unavailable } from '@/lib/server/mbta';
import { getStaticData } from '@/lib/server/static-data';
import { STATION_ID_RE } from '@/lib/static-data-fs';

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const q = url.searchParams;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  if (!STATION_ID_RE.test(from) || !STATION_ID_RE.test(to)) {
    return Response.json({ error: 'from and to must be station ids like place-pktrm' }, { status: 400 });
  }
  const extra = parseClosedParam(q.get('closed'));
  if (extra === null) {
    return Response.json({ error: 'closed must be up to 50 comma-separated facility ids' }, { status: 400 });
  }
  let data;
  try {
    data = getStaticData();
  } catch {
    return unavailable('Static data');
  }
  try {
    const live = await getAlertsOrDemo(getParentOf(), () => loadDemoAlerts(url.origin));
    const body = envelope(planWithClosures(data, from, to, live.closedFacilityIds, extra), live.result);
    const cacheControl = q.has('closed') ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=60';
    return Response.json(body, { headers: { 'Cache-Control': cacheControl } });
  } catch {
    return unavailable('Route planning');
  }
}
