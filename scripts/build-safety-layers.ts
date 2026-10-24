// Build three map/panel layers from public open data:
//   public/data/fatalities.json      Boston Vision Zero fatality records (fatal crashes)
//   public/data/safety-concerns.json Boston Vision Zero safety concerns reported by residents (no free text)
//   public/data/ej.geojson           MassGIS 2020 environmental-justice block groups in towns with subway stations
// Run: npx tsx scripts/build-safety-layers.ts            (all three)
//      npx tsx scripts/build-safety-layers.ts fatal      (or: concerns, ej)
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Fatality, SafetyConcern } from '../src/lib/warnings';

const DATA = path.join(process.cwd(), 'public', 'data');
const CKAN = 'https://data.boston.gov/api/3/action/datastore_search';
const FATAL_RESOURCE = '92f18923-d4ec-4c17-9405-4e0da63e1d6c';
const CONCERN_RESOURCE = '42c33f05-2572-404e-9782-38d755f0f069';
const EJ_QUERY = 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/EJ2020/MapServer/0/query';

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Greater-Boston box: drops (0,0) and far-away placeholder points. */
const inBox = (lat: number, lon: number) => lat > 42.15 && lat < 42.55 && lon > -71.4 && lon < -70.85;
const str = (v: unknown) => (v == null || v === 'None' ? '' : String(v).trim());

async function ckanAll(resource: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${CKAN}?resource_id=${resource}&limit=32000`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`CKAN ${resource}: HTTP ${res.status}`);
  const body = (await res.json()) as { success: boolean; result?: { records: Record<string, unknown>[] } };
  if (!body.success || !body.result) throw new Error(`CKAN ${resource}: success=false`);
  return body.result.records;
}

/** "W FIRST ST" -> "W First St". */
export function titleStreet(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, n: string, suf: string) => n + suf.toLowerCase());
}

/** Local (Boston) calendar date of an instant. */
function bostonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// ------------------------------------------------------------------ A) fatal crashes
const FATAL_MODE: Record<string, string> = { ped: 'pedestrian', bike: 'bicyclist', mv: 'motor vehicle' };

async function buildFatalities() {
  const rows = await ckanAll(FATAL_RESOURCE);
  const out: Fatality[] = [];
  for (const r of rows) {
    const lat = Number(r.lat);
    const lon = Number(r.long);
    const when = new Date(str(r.date_time).replace(' ', 'T').replace(/\+00$/, 'Z'));
    if (!inBox(lat, lon) || Number.isNaN(when.getTime()) || when.getUTCFullYear() < 2010) continue;
    const street = titleStreet(str(r.street));
    const x1 = titleStreet(str(r.xstreet1));
    const x2 = titleStreet(str(r.xstreet2));
    let label: string;
    if (str(r.location_type) === 'Intersection' || !street) label = [x1, x2].filter(Boolean).join(' & ') || street;
    else label = x1 ? `${street} near ${x1}` : street;
    out.push({
      id: `vzf-${r._id}`,
      date: bostonDate(when),
      mode: FATAL_MODE[str(r.mode_type)] ?? 'unknown',
      label: label || 'Location not recorded',
      lat: round5(lat),
      lon: round5(lon),
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  writeFileSync(path.join(DATA, 'fatalities.json'), JSON.stringify(out));
  console.log(`fatalities.json: ${out.length} fatal crashes (of ${rows.length} records)`);
  const byYear: Record<string, Record<string, number>> = {};
  for (const f of out) {
    const y = f.date.slice(0, 4);
    byYear[y] ??= {};
    byYear[y][f.mode] = (byYear[y][f.mode] ?? 0) + 1;
  }
  for (const y of Object.keys(byYear).sort()) console.log(`  ${y}: ${JSON.stringify(byYear[y])}`);
  const byMode: Record<string, number> = {};
  for (const f of out) byMode[f.mode] = (byMode[f.mode] ?? 0) + 1;
  console.log(`  by mode: ${JSON.stringify(byMode)}`);
}

// ------------------------------------------------------------------ B) resident safety concerns
/** Survey `request` codes -> plain words (codes confirmed against the live data, Oct 2026). */
export const CONCERN_WORDS: Record<string, string> = {
  speeding: 'speeding',
  runlightssigns: 'people run red lights or stop signs',
  yieldturn: 'drivers do not yield when turning',
  yieldgoing: 'drivers do not yield to people crossing',
  visibility: 'hard to see (poor visibility)',
  doublepark: 'double parking',
  notenoughtime: 'not enough time to cross',
  walksignal: 'long wait for the walk signal',
  sidewalk: 'sidewalk or curb ramp missing or broken',
  bikefacility: 'bike lane missing, blocked or broken',
  roadwaymaint: 'road surface needs repair',
  toomanylanes: 'too many lanes to cross',
  awayfromside: 'no crosswalk nearby',
  other: 'other safety concern',
};
const CONCERN_MODE: Record<string, string> = {
  walks: 'walking',
  bikes: 'biking',
  drives: 'driving',
  'uses an assistive device': 'assistive device',
  other: 'other',
};

async function buildConcerns() {
  const rows = await ckanAll(CONCERN_RESOURCE);
  const distinct: Record<string, number> = {};
  for (const r of rows) distinct[str(r.request)] = (distinct[str(r.request)] ?? 0) + 1;
  console.log('distinct request values:');
  for (const [k, n] of Object.entries(distinct).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k || '(blank)'} (${n}) -> ${CONCERN_WORDS[k] ?? 'other safety concern (unmapped)'}`);

  const out: SafetyConcern[] = [];
  for (const r of rows) {
    const lat = Number(r.POINT_Y);
    const lon = Number(r.POINT_X);
    // "6/14/2022 19:38:00.000" -> 2022-06-14 (date part only; no time zone in the source).
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str(r.date_and_time));
    if (!inBox(lat, lon) || !m || Number(m[3]) < 2015) continue;
    const req = str(r.request);
    out.push({
      id: `vzc-${r._id}`,
      date: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      mode: CONCERN_MODE[str(r.your_mode_of_transportation)] ?? 'other',
      concern: CONCERN_WORDS[req] ?? 'other safety concern',
      lat: round5(lat),
      lon: round5(lon),
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  writeFileSync(path.join(DATA, 'safety-concerns.json'), JSON.stringify(out));
  console.log(`safety-concerns.json: ${out.length} reports (of ${rows.length}); ${out[out.length - 1]?.date} .. ${out[0]?.date}`);
}

// ------------------------------------------------------------------ D) environmental-justice block groups
/** Used only if the Census reverse lookup is unreachable. */
const FALLBACK_TOWNS = ['Boston', 'Braintree', 'Brookline', 'Cambridge', 'Malden', 'Medford', 'Milton', 'Newton', 'Quincy', 'Revere', 'Somerville'];

async function townOf(lat: number, lon: number): Promise<string | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/geographies/coordinates' +
    `?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=County%20Subdivisions&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { geographies?: Record<string, { BASENAME?: string }[]> } };
    // Census names some towns "Braintree Town"; MassGIS MUNICIPALITY is plain "Braintree".
    const name = body.result?.geographies?.['County Subdivisions']?.[0]?.BASENAME;
    return name ? name.replace(/\s+(Town|City)$/i, '') : null;
  } catch {
    return null;
  }
}

async function stationTowns(): Promise<string[]> {
  const stations = JSON.parse(readFileSync(path.join(DATA, 'stations.json'), 'utf8')) as { name: string; lat: number; lon: number }[];
  const towns = new Map<string, string[]>();
  let failed = 0;
  for (let i = 0; i < stations.length; i += 10) {
    const batch = stations.slice(i, i + 10);
    const names = await Promise.all(batch.map((s) => townOf(s.lat, s.lon)));
    batch.forEach((s, j) => {
      const t = names[j];
      if (!t) return void failed++;
      towns.set(t, [...(towns.get(t) ?? []), s.name]);
    });
  }
  if (failed > stations.length / 4) {
    console.log(`  reverse lookup failed for ${failed} stations; using fallback town list`);
    return FALLBACK_TOWNS;
  }
  console.log(`  stations by town (reverse lookup, ${failed} failed):`);
  for (const [t, s] of [...towns].sort()) console.log(`    ${t}: ${s.length} (${s.slice(0, 4).join(', ')}${s.length > 4 ? ', ...' : ''})`);
  return [...towns.keys()].sort();
}

type GeoFeature = { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> };

async function buildEj() {
  const towns = await stationTowns();
  const where = `MUNICIPALITY IN (${towns.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`;
  const features: GeoFeature[] = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      where,
      outFields: 'GEOID,MUNICIPALITY,TOTAL_POP,PCT_MINORITY,LIMENGHHPCT,BG_MHHI,EJ_CRIT_DESC',
      returnGeometry: 'true',
      outSR: '4326',
      maxAllowableOffset: '0.0002',
      geometryPrecision: '5',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: '1000',
      f: 'geojson',
    });
    const res = await fetch(`${EJ_QUERY}?${params}`);
    if (!res.ok) throw new Error(`EJ query: HTTP ${res.status}`);
    const body = (await res.json()) as { features?: GeoFeature[]; error?: unknown };
    if (!body.features) throw new Error('EJ query: no features');
    for (const f of body.features) {
      const p = f.properties;
      const pop = Number(p.TOTAL_POP);
      const mhhi = Number(p.BG_MHHI);
      features.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          geoid: String(p.GEOID ?? ''),
          municipality: String(p.MUNICIPALITY ?? ''),
          population: Number.isFinite(pop) ? pop : 0,
          pctMinority: Number.isFinite(Number(p.PCT_MINORITY)) && p.PCT_MINORITY != null ? round1(Number(p.PCT_MINORITY)) : null,
          limitedEnglishPct: Number.isFinite(Number(p.LIMENGHHPCT)) && p.LIMENGHHPCT != null ? round1(Number(p.LIMENGHHPCT)) : null,
          // 0 and null are "not available" in the source, not a real income.
          medianIncome: p.BG_MHHI != null && Number.isFinite(mhhi) && mhhi > 0 ? mhhi : null,
          criteria: String(p.EJ_CRIT_DESC ?? ''),
        },
      });
    }
    if (body.features.length < 1000) break;
  }
  const file = path.join(DATA, 'ej.geojson');
  writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
  const kb = Math.round(statSync(file).size / 1024);
  const byTown: Record<string, number> = {};
  for (const f of features) byTown[String(f.properties.municipality)] = (byTown[String(f.properties.municipality)] ?? 0) + 1;
  console.log(`ej.geojson: ${features.length} EJ block groups, ${kb} KB`);
  console.log(`  by town: ${JSON.stringify(byTown)}`);
}

async function main() {
  mkdirSync(DATA, { recursive: true });
  const only = process.argv[2];
  if (!only || only === 'fatal') await buildFatalities();
  if (!only || only === 'concerns') await buildConcerns();
  if (!only || only === 'ej') await buildEj();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
