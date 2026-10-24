// GET /api/stations/status -> step-free status of every subway station, with live elevator closures applied.
// Same fallback chain as /api/route and /api/station/[id]: MBTA alerts -> last good -> demo snapshot.
import { connection } from 'next/server';
import { getAlertsOrDemo } from '@/lib/lastmile-service';
import { stationStatus, type StationStatus } from '@/lib/router';
import { envelope, getParentOf, jsonWithCache, loadDemoAlerts, unavailable } from '@/lib/server/mbta';
import { getStaticData } from '@/lib/server/static-data';

type StationStatusRow = { id: string; name: string } & Pick<
  StationStatus,
  'stepFree' | 'approximate' | 'blockedBy' | 'partial' | 'blockedPlatforms'
>;

export async function GET(request: Request) {
  await connection();
  let data;
  try {
    data = getStaticData();
  } catch {
    return unavailable('Static data');
  }
  try {
    const live = await getAlertsOrDemo(getParentOf(), () => loadDemoAlerts(new URL(request.url).origin));
    const closed = new Set(live.closedFacilityIds);
    const stations: StationStatusRow[] = data.stations.map((s) => {
      const st = stationStatus(data, s.id, closed);
      return {
        id: s.id,
        name: s.name,
        stepFree: st.stepFree,
        approximate: st.approximate,
        blockedBy: st.blockedBy,
        partial: st.partial,
        blockedPlatforms: st.blockedPlatforms,
      };
    });
    return jsonWithCache(envelope({ stations, closedFacilityIds: live.closedFacilityIds }, live.result), 30, 60);
  } catch {
    return unavailable('Station status');
  }
}
