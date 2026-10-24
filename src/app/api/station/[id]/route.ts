// GET /api/station/place-xxxx -> station, facilities (with closed flag), step-free status, parking, alerts.
import { connection } from 'next/server';
import { getAlertsOrDemo, stationDetail } from '@/lib/lastmile-service';
import { envelope, getParentOf, jsonWithCache, loadDemoAlerts, unavailable } from '@/lib/server/mbta';
import { getStaticData } from '@/lib/server/static-data';
import { STATION_ID_RE } from '@/lib/static-data-fs';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  if (!STATION_ID_RE.test(id)) {
    return Response.json({ error: 'id must be a station id like place-pktrm' }, { status: 400 });
  }
  let data;
  try {
    data = getStaticData();
  } catch {
    return unavailable('Static data');
  }
  if (!data.stationById.has(id)) return Response.json({ error: 'unknown station' }, { status: 404 });
  try {
    const live = await getAlertsOrDemo(getParentOf(), () => loadDemoAlerts(new URL(request.url).origin));
    const detail = stationDetail(data, id, live.alerts, live.closedFacilityIds)!;
    return jsonWithCache(envelope(detail, live.result), 30, 60);
  } catch {
    return unavailable('Station');
  }
}
