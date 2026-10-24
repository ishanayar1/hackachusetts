// GET /api/equity -> people in environmental-justice block groups (MassGIS EJ 2020) within 800 m of each
// subway station that is not step-free or only partly step-free right now (live elevator closures applied).
// Same fallback chain as /api/stations/status: MBTA alerts -> last good -> demo snapshot.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { connection } from 'next/server';
import { equitySummary, type EjFeature } from '@/lib/equity';
import { getAlertsOrDemo } from '@/lib/lastmile-service';
import { stationStatus } from '@/lib/router';
import { envelope, getParentOf, jsonWithCache, loadDemoAlerts, unavailable } from '@/lib/server/mbta';
import { getStaticData } from '@/lib/server/static-data';

let ejCache: EjFeature[] | null = null;

async function getEjFeatures(): Promise<EjFeature[]> {
  if (ejCache) return ejCache;
  const raw = JSON.parse(await readFile(path.join(process.cwd(), 'public', 'data', 'ej.geojson'), 'utf8')) as {
    features?: unknown;
  };
  if (!Array.isArray(raw.features)) throw new Error('ej.geojson has no features');
  ejCache = raw.features as EjFeature[];
  return ejCache;
}

export async function GET(request: Request) {
  await connection();
  let data;
  let ej;
  try {
    data = getStaticData();
    ej = await getEjFeatures();
  } catch {
    return unavailable('Static data');
  }
  try {
    const live = await getAlertsOrDemo(getParentOf(), () => loadDemoAlerts(new URL(request.url).origin));
    const closed = new Set(live.closedFacilityIds);
    const status = data.stations.map((s) => {
      const st = stationStatus(data, s.id, closed);
      return { id: s.id, stepFree: st.stepFree, partial: st.partial };
    });
    return jsonWithCache(envelope(equitySummary(status, data.stations, ej), live.result), 30, 60);
  } catch {
    return unavailable('Equity summary');
  }
}
