// Build public/data/hazards.json from Boston 311 open cases (data.boston.gov CKAN datastore).
// Run: npx tsx scripts/build-311-hazards.ts
// Source: "311 Service Requests - NEW SYSTEM" (resource 254adca6-64ab-4c5c-9fc0-a6da622be185).
// Keeps OPEN cases (case_status not Closed) opened in the last 120 days with coordinates.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Hazard } from '../src/lib/warnings';

const RESOURCE = '254adca6-64ab-4c5c-9fc0-a6da622be185';
const TOPICS = ['Sidewalk Repair', 'Illegally Blocked Sidewalk', 'Street Light Outage'];
const DAYS = 120;
const OUT = path.join(process.cwd(), 'public', 'data', 'hazards.json');

const LABEL: Record<string, string> = {
  'Sidewalk Repair': 'Sidewalk repair reported',
  'Illegally Blocked Sidewalk': 'Blocked sidewalk reported',
  'Street Light Outage': 'Street light out',
};

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

type Row = { case_id: string; open_date: string; case_topic: string; street_name: string | null; latitude: string; longitude: string };

async function main() {
  const topics = TOPICS.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
  const sql =
    `SELECT case_id, open_date, case_topic, street_name, latitude, longitude FROM "${RESOURCE}" ` +
    `WHERE case_topic IN (${topics}) AND case_status <> 'Closed' ` +
    `AND latitude IS NOT NULL AND longitude IS NOT NULL ` +
    `AND open_date::timestamptz > now() - interval '${DAYS} days' ORDER BY open_date DESC LIMIT 30000`;
  const url = `https://data.boston.gov/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`311 query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { success: boolean; result?: { records: Row[] } };
  if (!body.success || !body.result) throw new Error('311 query failed: success=false');

  const out: Hazard[] = [];
  const seen = new Set<string>();
  for (const r of body.result.records) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    // Boston bounding box; 311 sometimes uses a city-hall default point, which is still in the box.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 42.2 || lat > 42.42 || lon < -71.2 || lon > -70.95) continue;
    if (seen.has(r.case_id)) continue;
    seen.add(r.case_id);
    const street = (r.street_name ?? '').trim();
    const base = LABEL[r.case_topic] ?? r.case_topic;
    const opened = new Date(r.open_date.replace(' ', 'T').replace(/\+00$/, 'Z'));
    out.push({
      id: r.case_id,
      type: r.case_topic,
      label: street ? `${base} on ${street}` : base,
      openedAt: Number.isNaN(opened.getTime()) ? r.open_date : opened.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      lat: round5(lat),
      lon: round5(lon),
    });
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const counts: Record<string, number> = {};
  for (const h of out) counts[h.type] = (counts[h.type] ?? 0) + 1;
  console.log(`hazards.json: ${out.length} open 311 cases (last ${DAYS} days)`);
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
