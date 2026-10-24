// Build public/data/ramps.json from Boston's Pedestrian Ramp Inventory (data.boston.gov CKAN).
// Run: npx tsx scripts/build-ramps.ts
// Keeps only ramps in poor condition (COND starts with "P") or with a lip (LIP = YES).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ramp } from '../src/lib/warnings';

const CKAN = 'https://data.boston.gov/api/3/action';
const OUT = path.join(process.cwd(), 'public', 'data', 'ramps.json');
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  const body = (await res.json()) as { success: boolean; result: T };
  if (!body.success) throw new Error(`CKAN success=false for ${url.slice(0, 80)}`);
  return body.result;
}

type Resource = { id: string; format: string; datastore_active?: boolean };
type Row = { RAMP_ID: string | number | null; COND: string | null; LIP: string | null; shape_wkt: string | null };

async function findResource(): Promise<string> {
  try {
    const pkg = await getJson<{ resources: Resource[] }>(`${CKAN}/package_show?id=pedestrian-ramp-inventory`);
    const r = pkg.resources.find((x) => x.datastore_active);
    if (r) return r.id;
  } catch {
    /* fall through to search */
  }
  const s = await getJson<{ results: { resources: Resource[] }[] }>(
    `${CKAN}/package_search?q=${encodeURIComponent('pedestrian ramp inventory')}&rows=5`,
  );
  for (const p of s.results) {
    const r = p.resources.find((x) => x.datastore_active);
    if (r) return r.id;
  }
  throw new Error('Pedestrian Ramp Inventory datastore resource not found');
}

function conditionOf(cond: string, lip: string): string | null {
  const poor = cond.trim().toUpperCase().startsWith('P');
  const hasLip = lip.trim().toUpperCase() === 'YES';
  if (poor && hasLip) return 'poor condition, lip at edge';
  if (poor) return 'poor condition';
  if (hasLip) return 'lip at edge';
  return null;
}

async function main() {
  const id = await findResource();
  const sql =
    `SELECT "RAMP_ID", "COND", "LIP", "shape_wkt" FROM "${id}" ` +
    `WHERE upper("COND") LIKE 'P%' OR upper("LIP") = 'YES'`;
  const { records } = await getJson<{ records: Row[] }>(
    `${CKAN}/datastore_search_sql?sql=${encodeURIComponent(sql)}`,
  );

  const out: Ramp[] = [];
  const counts: Record<string, number> = {};
  let skipped = 0;
  for (const r of records) {
    const condition = conditionOf(r.COND ?? '', r.LIP ?? '');
    const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(r.shape_wkt ?? '');
    if (!condition || !m || r.RAMP_ID == null) {
      skipped++;
      continue;
    }
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped++;
      continue;
    }
    const rawId = String(r.RAMP_ID).trim();
    const id = /^\d+(\.0*)?$/.test(rawId) ? String(Math.round(Number(rawId))) : rawId;
    out.push({ id, condition, lat: round5(lat), lon: round5(lon) });
    counts[condition] = (counts[condition] ?? 0) + 1;
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`ramps.json: ${out.length} ramps (poor or lipped), ${skipped} skipped, from ${records.length} rows`);
  for (const [c, n] of Object.entries(counts)) console.log(`  ${c}: ${n}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
