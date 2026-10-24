// Address search for saved places: OpenStreetMap Nominatim, limited to Greater Boston.
// Framework-agnostic; `fetch` is injectable so tests never touch the network. Never throws.
// Nominatim's usage policy allows about 1 request a second: the client searches on a button press
// (not per keystroke), and results are cached in memory for a day.
import { BOSTON_BBOX, getJson, type FetchLike } from './walk';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

export type GeoHit = { label: string; lat: number; lon: number };

const cache = new Map<string, { hits: GeoHit[]; expiresAt: number }>();
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const inBoston = (lat: number, lon: number) =>
  lat >= BOSTON_BBOX.minLat && lat <= BOSTON_BBOX.maxLat && lon >= BOSTON_BBOX.minLon && lon <= BOSTON_BBOX.maxLon;

export async function geocode(q: string, deps: { fetch?: FetchLike; noCache?: boolean } = {}): Promise<GeoHit[]> {
  const key = q.trim().toLowerCase();
  const hit = deps.noCache ? undefined : cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.hits;

  const { minLon, maxLat, maxLon, minLat } = BOSTON_BBOX;
  const url =
    `${NOMINATIM_URL}?format=jsonv2&limit=5&countrycodes=us&bounded=1` +
    `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&q=${encodeURIComponent(q.trim())}`;
  let hits: GeoHit[] = [];
  try {
    const body = await getJson(url, { fetch: deps.fetch });
    if (Array.isArray(body)) {
      hits = body
        .map((r: { display_name?: unknown; lat?: unknown; lon?: unknown }) => ({
          label: String(r.display_name ?? '').split(',').slice(0, 3).join(',').trim(),
          lat: Number(r.lat),
          lon: Number(r.lon),
        }))
        .filter((h) => h.label && Number.isFinite(h.lat) && Number.isFinite(h.lon) && inBoston(h.lat, h.lon))
        .map((h) => ({ ...h, lat: r5(h.lat), lon: r5(h.lon) }));
    }
  } catch {
    return []; // upstream down: not cached, so the next search tries again
  }
  if (!deps.noCache) {
    cache.set(key, { hits, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return hits;
}
