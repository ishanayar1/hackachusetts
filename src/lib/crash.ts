// Recorded crash history per H3 cell (from crash-risk/risk.geojson -> public/data/crash-risk.geojson).
// Framework-agnostic and pure: used by /api/crash/locations and the tests.
// Wording rule (docs/lastmile-plan.md): these are "recorded crashes", not a prediction or "risk".
// `estimatePerYear` is the teammate model's yearly estimate (risk_yr); it is only used when sort=model.

export type CrashSpot = {
  hex: string;
  label: string;
  lat: number;
  lng: number;
  /** Recorded pedestrian + bike crashes. */
  pedBike: number;
  ped: number;
  bike: number;
  mv: number;
  total: number;
  /** Model estimate of crashes per year (risk_yr). Not shown as a prediction by default. */
  estimatePerYear: number;
};

export type CrashSort = 'recorded' | 'model';
export type CrashQuery = { q: string; limit: number; sort: CrashSort };

export const CRASH_LIMIT_DEFAULT = 50;
export const CRASH_LIMIT_MAX = 200;
export const CRASH_Q_MAX = 100;

const UNKNOWN = 'Unknown location';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function count(v: unknown): number {
  return Math.max(0, Math.round(num(v)));
}

/** GeoJSON FeatureCollection (crash-risk.geojson) -> CrashSpot[]. Skips features without a hex id or valid coordinates. */
export function toCrashSpots(fc: unknown): CrashSpot[] {
  const features = (fc as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: CrashSpot[] = [];
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> } | null)?.properties;
    if (!p || typeof p.hex !== 'string' || !p.hex) continue;
    const lat = typeof p.lat === 'number' ? p.lat : Number(p.lat);
    const lng = typeof p.lng === 'number' ? p.lng : Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : UNKNOWN;
    const ped = count(p.ped);
    const bike = count(p.bike);
    const mv = count(p.mv);
    const total = Math.max(count(p.total_crashes), ped + bike + mv);
    out.push({ hex: p.hex, label, lat, lng, pedBike: ped + bike, ped, bike, mv, total, estimatePerYear: num(p.risk_yr) });
  }
  return out;
}

const byRecorded = (a: CrashSpot, b: CrashSpot) =>
  b.pedBike - a.pedBike || b.total - a.total || a.hex.localeCompare(b.hex);
const byModel = (a: CrashSpot, b: CrashSpot) =>
  b.estimatePerYear - a.estimatePerYear || byRecorded(a, b);

/** Filter by label (case-insensitive substring), sort, then cut to limit. `count` is the number of matches before the limit. */
export function queryCrashSpots(
  spots: readonly CrashSpot[],
  opts: Partial<CrashQuery> = {},
): { count: number; results: CrashSpot[] } {
  const q = (opts.q ?? '').trim().toLowerCase();
  const limit = Math.min(CRASH_LIMIT_MAX, Math.max(1, Math.floor(opts.limit ?? CRASH_LIMIT_DEFAULT)));
  const matches = q ? spots.filter((s) => s.label.toLowerCase().includes(q)) : [...spots];
  matches.sort(opts.sort === 'model' ? byModel : byRecorded);
  return { count: matches.length, results: matches.slice(0, limit) };
}

/** Validate ?q=&limit=&sort= for /api/crash/locations. */
export function parseCrashQuery(
  params: URLSearchParams,
): { ok: true; value: CrashQuery } | { ok: false; error: string } {
  const q = (params.get('q') ?? '').trim();
  if (q.length > CRASH_Q_MAX) return { ok: false, error: `q must be at most ${CRASH_Q_MAX} characters` };

  const rawLimit = params.get('limit');
  let limit = CRASH_LIMIT_DEFAULT;
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d{1,4}$/.test(rawLimit)) return { ok: false, error: `limit must be an integer from 1 to ${CRASH_LIMIT_MAX}` };
    limit = Number(rawLimit);
    if (limit < 1 || limit > CRASH_LIMIT_MAX) {
      return { ok: false, error: `limit must be an integer from 1 to ${CRASH_LIMIT_MAX}` };
    }
  }

  const rawSort = params.get('sort');
  let sort: CrashSort = 'recorded';
  if (rawSort !== null && rawSort !== '') {
    if (rawSort !== 'recorded' && rawSort !== 'model') return { ok: false, error: 'sort must be recorded or model' };
    sort = rawSort;
  }
  return { ok: true, value: { q, limit, sort } };
}
