// Recorded crash history per H3 cell (from crash-risk/risk.geojson -> public/data/crash-risk.geojson).
// Framework-agnostic and pure: used by /api/crash/locations and the tests.
// Wording rule (docs/lastmile-plan.md): these are "recorded crashes", not a prediction or "risk".
// `estimatePerYear` is the teammate model's yearly estimate (risk_yr); it is only used when sort=model.

export type CrashSpot = {
  hex: string;
  /** Display name, unique within the dataset: the crash intersection from label_csv ("Boylston St & Massachusetts Ave")
   *  when it is a real street, else the OSM street. Duplicates get the area, then a nearby street, then a number. */
  label: string;
  /** OSM neighbourhood (part of label_osm after the comma), e.g. "Back Bay". */
  area?: string;
  /** Raw OSM reverse-geocode label (label_osm), e.g. "Massachusetts Turnpike, Back Bay". */
  osmLabel?: string;
  /** Raw most-frequent crash intersection from the crash CSV (label_csv), e.g. "Boylston St @ Massachusetts Ave". */
  csvLabel?: string;
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

function str(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

// Parts of a CSV intersection that carry no street name.
const NO_NAME = /^(dead end|null|unknown( location)?|ramp\b.*|.*\bnull\b.*)$/i;
// Highway-only names (no sidewalks): a crash area is not named after these when a better name exists.
const HIGHWAY =
  /^(interstate\s*\d+.*|i-?\s*\d+\b.*|massachusetts (tpke|turnpike)|us (hwy|highway|route|rte) \d+.*|(route|rte) \d+[a-z]?|.*\bramp\b.*|.*\bconnector\b.*|.*\btunnel\b.*)$/i;
const WORD_FIX: Record<string, string> = {
  vfw: 'VFW', us: 'US', mlk: 'MLK', jfk: 'JFK', umass: 'UMass', obrien: "O'Brien", oneil: "O'Neil", oneill: "O'Neill", brg: 'Bridge',
};

function titleWord(w: string): string {
  return w
    .split('-')
    .map((part) => {
      const lower = part.toLowerCase();
      if (WORD_FIX[lower]) return WORD_FIX[lower];
      if (!/^[a-z]/.test(lower)) return lower; // 1st, 2nd, numbers
      if (/^mc[a-z]{2,}/.test(lower)) return 'Mc' + lower[2].toUpperCase() + lower.slice(3);
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join('-');
}

const titleCase = (s: string) => s.split(' ').map(titleWord).join(' ');

/** "Albany Street, South End" -> { street: "Albany Street", area: "South End" }. */
function splitOsm(osm: string): { street: string; area?: string } {
  const parts = osm.split(',').map((s) => s.trim()).filter(Boolean);
  return { street: parts[0] ?? '', area: parts[1] || undefined };
}

/** CSV crash location ("Boylston St @ Massachusetts Ave") -> "Boylston St & Massachusetts Ave", or '' when it names
 *  no real street (unknown, dead end, ramp, or a highway on its own). */
function csvName(csv: string): string {
  const parts = csv
    .split('@')
    .map((s) => s.trim())
    .filter((s) => s && !NO_NAME.test(s));
  const streets = parts.filter((s) => !HIGHWAY.test(s));
  return streets.length ? streets.map(titleCase).join(' & ') : '';
}

/** Display name for one crash area (GeoJSON properties). Shared by the API and the map so both use the same name.
 *  Prefers the CSV crash intersection, falls back to the OSM street, then "Unknown location". Not deduplicated. */
export function crashLabel(props: Record<string, unknown>): { label: string; area?: string } {
  const osm = splitOsm(str(props.label_osm) || str(props.label));
  const label = csvName(str(props.label_csv)) || osm.street || UNKNOWN;
  return osm.area ? { label, area: osm.area } : { label };
}

const lc = (s: string) => s.toLowerCase();

function groupDuplicates(spots: CrashSpot[]): CrashSpot[][] {
  const groups = new Map<string, CrashSpot[]>();
  for (const s of spots) {
    const k = lc(s.label);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Make labels unique (in place): add the area, then the OSM street ("near ..."), then a number by crash count. */
function makeLabelsUnique(spots: CrashSpot[]): void {
  for (const g of groupDuplicates(spots)) {
    for (const s of g) if (s.area && !lc(s.label).includes(lc(s.area))) s.label = `${s.label}, ${s.area}`;
  }
  for (const g of groupDuplicates(spots)) {
    // Only when every spot in the group gets a different nearby street that is not already in its name.
    const near = g.map((s) => splitOsm(s.osmLabel ?? '').street);
    const norm = near.map((n) => searchTokens(n).join(' '));
    const useful = near.every(
      (n, i) => n && !` ${searchTokens(g[i].label).join(' ')} `.includes(` ${norm[i]} `) && norm.indexOf(norm[i]) === i,
    );
    if (useful) g.forEach((s, i) => (s.label = `${s.label} (near ${near[i]})`));
  }
  for (const g of groupDuplicates(spots)) {
    g.sort(byRecorded).forEach((s, i) => {
      if (i > 0) s.label = `${s.label} (${i + 1})`;
    });
  }
}

/** GeoJSON FeatureCollection (crash-risk.geojson) -> CrashSpot[] with unique labels. Skips features without a hex id
 *  or valid coordinates. */
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
    const { label, area } = crashLabel(p);
    const osmLabel = str(p.label_osm) || str(p.label) || undefined;
    const csvLabel = str(p.label_csv) || undefined;
    const ped = count(p.ped);
    const bike = count(p.bike);
    const mv = count(p.mv);
    const total = Math.max(count(p.total_crashes), ped + bike + mv);
    const spot: CrashSpot = { hex: p.hex, label, lat, lng, pedBike: ped + bike, ped, bike, mv, total, estimatePerYear: num(p.risk_yr) };
    if (area) spot.area = area;
    if (osmLabel) spot.osmLabel = osmLabel;
    if (csvLabel) spot.csvLabel = csvLabel;
    out.push(spot);
  }
  makeLabelsUnique(out);
  return out;
}

const SEARCH_ALIAS: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', boulevard: 'blvd', square: 'sq', place: 'pl', drive: 'dr',
  parkway: 'pkwy', highway: 'hwy', mass: 'massachusetts', mt: 'mount', bridge: 'brg', brg: 'brg',
};
const SEARCH_STOP = new Set(['and', 'at', 'near']);

function searchTokens(s: string): string[] {
  return lc(s)
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => SEARCH_ALIAS[t] ?? t);
}

const haystacks = new WeakMap<CrashSpot, string>();
function haystack(s: CrashSpot): string {
  let h = haystacks.get(s);
  if (h === undefined) {
    h = ` ${searchTokens([s.label, s.csvLabel, s.osmLabel, s.area].filter(Boolean).join(' ')).join(' ')} `;
    haystacks.set(s, h);
  }
  return h;
}

/** Every query word must appear in the label, CSV intersection, OSM label or area ("mass ave" finds "Massachusetts Ave"). */
function matchesQuery(s: CrashSpot, tokens: string[]): boolean {
  const h = haystack(s);
  return tokens.every((t) => h.includes(t));
}

const byRecorded = (a: CrashSpot, b: CrashSpot) =>
  b.pedBike - a.pedBike || b.total - a.total || a.hex.localeCompare(b.hex);
const byModel = (a: CrashSpot, b: CrashSpot) =>
  b.estimatePerYear - a.estimatePerYear || byRecorded(a, b);

/** Filter by label, CSV intersection, OSM label and area (case-insensitive, every word must match), sort, then cut to
 *  limit. `count` is the number of matches before the limit. */
export function queryCrashSpots(
  spots: readonly CrashSpot[],
  opts: Partial<CrashQuery> = {},
): { count: number; results: CrashSpot[] } {
  const all = searchTokens(opts.q ?? '');
  const content = all.filter((t) => !SEARCH_STOP.has(t));
  const tokens = content.length ? content : all;
  const limit = Math.min(CRASH_LIMIT_MAX, Math.max(1, Math.floor(opts.limit ?? CRASH_LIMIT_DEFAULT)));
  const matches = tokens.length ? spots.filter((s) => matchesQuery(s, tokens)) : [...spots];
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
