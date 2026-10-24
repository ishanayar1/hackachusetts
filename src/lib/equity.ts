// Equity view: how many people in environmental-justice (EJ) block groups live near subway stations
// that are not step-free (or only partly step-free) right now. Pure; data from public/data/ej.geojson
// (MassGIS EJ 2020 block groups, built by scripts/build-safety-layers.ts) and live station status.

export const EJ_RADIUS_M = 800;

export type EjProperties = {
  geoid?: string;
  municipality?: string;
  population?: number;
  pctMinority?: number | null;
  limitedEnglishPct?: number | null;
  medianIncome?: number | null;
  criteria?: string;
};
export type EjFeature = {
  type?: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: EjProperties | null;
};
/** Minimal status row (the shape /api/stations/status returns per station). */
export type StationStepFree = { id: string; stepFree: boolean; partial?: boolean };
export type EquityStation = { id: string; name: string; lat: number; lon: number };

export type BlockedStationEquity = {
  stationId: string;
  name: string;
  /** "not step-free" or "partly step-free" (text, not color). */
  status: 'not step-free' | 'partly step-free';
  /** Residents of EJ block groups whose centroid is within EJ_RADIUS_M of the station. */
  ejPopulationWithin800m: number;
  ejBlockGroups: number;
  /** Population-weighted share of limited-English households in those block groups; null if none. */
  limitedEnglishPct: number | null;
};
export type EquitySummary = {
  blockedStations: BlockedStationEquity[];
  /** Residents of EJ block groups near at least one blocked station (each block group counted once). */
  totalEjPopulationAffected: number;
  radiusM: number;
};

const M_PER_DEG_LAT = 111_320;

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const kx = M_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * M_PER_DEG_LAT);
}

type Ring = [number, number][];

function ringsOf(geometry: EjFeature['geometry']): Ring[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const c = geometry.coordinates as unknown[];
  // Outer rings only: Polygon -> c[0]; MultiPolygon -> each polygon's [0].
  if (geometry.type === 'Polygon') return Array.isArray(c[0]) ? [c[0] as Ring] : [];
  if (geometry.type === 'MultiPolygon') return c.map((p) => (Array.isArray(p) ? (p as Ring[])[0] : null)).filter(Boolean) as Ring[];
  return [];
}

/** Area-weighted centroid of the outer ring(s) as [lon, lat]; vertex mean for degenerate rings; null if none. */
export function polygonCentroid(geometry: EjFeature['geometry']): [number, number] | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const ring of ringsOf(geometry)) {
    const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) continue;
    const [ox, oy] = pts[0]; // local origin keeps the cross products well-conditioned
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const ax = x0 - ox;
      const ay = y0 - oy;
      const bx = x1 - ox;
      const by = y1 - oy;
      const cross = ax * by - bx * ay;
      a += cross;
      cx += (ax + bx) * cross + 3 * ox * cross;
      cy += (ay + by) * cross + 3 * oy * cross;
      sx += x0;
      sy += y0;
      n++;
    }
  }
  if (n === 0) return null;
  if (Math.abs(a) < 1e-14) return [sx / n, sy / n];
  return [cx / (3 * a), cy / (3 * a)];
}

type Group = { key: string; lat: number; lon: number; pop: number; leng: number | null };

function groupsOf(features: readonly EjFeature[]): Group[] {
  const out: Group[] = [];
  features.forEach((f, i) => {
    if (!f) return;
    const c = polygonCentroid(f.geometry);
    if (!c) return;
    const p = f.properties ?? {};
    const pop = Number(p.population);
    const leng = p.limitedEnglishPct == null ? NaN : Number(p.limitedEnglishPct);
    out.push({
      key: p.geoid || `#${i}`,
      lon: c[0],
      lat: c[1],
      pop: Number.isFinite(pop) && pop > 0 ? pop : 0,
      leng: Number.isFinite(leng) ? leng : null,
    });
  });
  return out;
}

export function equitySummary(
  stationsStatus: readonly StationStepFree[],
  stations: readonly EquityStation[],
  ejFeatures: readonly EjFeature[],
  radiusM: number = EJ_RADIUS_M,
): EquitySummary {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const groups = groupsOf(ejFeatures ?? []);
  const affected = new Map<string, number>();
  const blockedStations: BlockedStationEquity[] = [];

  for (const st of stationsStatus ?? []) {
    if (!st) continue;
    const blocked = !st.stepFree || st.partial === true;
    if (!blocked) continue;
    const s = byId.get(st.id);
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    let pop = 0;
    let count = 0;
    let lengW = 0;
    let lengPop = 0;
    for (const g of groups) {
      if (distanceM(s.lat, s.lon, g.lat, g.lon) > radiusM) continue;
      pop += g.pop;
      count++;
      if (g.leng != null && g.pop > 0) {
        lengW += g.leng * g.pop;
        lengPop += g.pop;
      }
      affected.set(g.key, g.pop);
    }
    blockedStations.push({
      stationId: s.id,
      name: s.name,
      status: st.stepFree ? 'partly step-free' : 'not step-free',
      ejPopulationWithin800m: pop,
      ejBlockGroups: count,
      limitedEnglishPct: lengPop > 0 ? Math.round((lengW / lengPop) * 10) / 10 : null,
    });
  }

  blockedStations.sort(
    (a, b) => b.ejPopulationWithin800m - a.ejPopulationWithin800m || a.name.localeCompare(b.name),
  );
  let total = 0;
  for (const p of affected.values()) total += p;
  return { blockedStations, totalEjPopulationAffected: total, radiusM };
}
