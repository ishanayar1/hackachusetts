// Walking route for wheelchair users: Valhalla (wheelchair costing) -> OSRM foot -> straight line.
// Framework-agnostic: no Next imports. `fetch` is injectable so tests never touch the network.
// Valhalla public server is shared: every result is cached in memory (6 h, 500 entries max).

import type { WalkWarnings } from './warnings';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface WalkStep {
  instruction: string;
  distanceM: number;
  /** Where the step starts, when the router gives it. */
  lat?: number;
  lon?: number;
}


export interface WalkResult {
  source: 'valhalla' | 'osrm' | 'straight';
  distanceM: number;
  minutes: number;
  coordinates: [number, number][]; // [lon, lat]
  steps: WalkStep[];
  approximate: boolean;
  warnings?: WalkWarnings;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface WalkDeps {
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
  /** Skip the in-memory cache (tests). */
  noCache?: boolean;
}

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const OSRM_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
export const OSRM_CAR_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';
const USER_AGENT = 'LastMile hackathon app (accessible transit last-mile walking routes)';
const TIMEOUT_MS = 6_000;
const WHEELCHAIR_MPS = 1; // straight-line and OSRM time estimate
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STRAIGHT_TTL_MS = 2 * 60 * 1000; // upstreams were down: retry soon
const CACHE_MAX = 500;

// ---------- validation ----------
export const BOSTON_BBOX = { minLat: 42.1, maxLat: 42.6, minLon: -71.4, maxLon: -70.8 } as const;

/** Parses "lat,lon" and checks it is inside Greater Boston. Returns null when invalid. */
export function parseLatLon(raw: string | null | undefined): LatLon | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (parts[0].trim() === '' || parts[1].trim() === '') return null;
  const b = BOSTON_BBOX;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return null;
  return { lat, lon };
}

// ---------- geometry ----------
/** Google encoded polyline. Returns [lat, lon] pairs. Valhalla uses precision 6. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = Math.pow(10, precision);
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (let k = 0; k < 2; k++) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += delta;
      else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function compass(a: LatLon, b: LatLon): string {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * toRad) * Math.cos(b.lat * toRad);
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lon - a.lon) * toRad);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- upstreams ----------
export async function getJson(url: string, deps: WalkDeps): Promise<unknown> {
  const f: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const res = await f(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

interface ValhallaResponse {
  trip?: {
    summary?: { time?: number; length?: number };
    legs?: { shape?: string; maneuvers?: { instruction?: string; length?: number; begin_shape_index?: number }[] }[];
  };
}

export async function fromValhalla(from: LatLon, to: LatLon, deps: WalkDeps = {}): Promise<WalkResult> {
  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: 'pedestrian',
    costing_options: { pedestrian: { type: 'wheelchair', max_grade: 6, step_penalty: 10000 } },
    units: 'kilometers',
  };
  const j = (await getJson(`${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(body))}`, deps)) as ValhallaResponse;
  const leg = j.trip?.legs?.[0];
  if (!leg?.shape || !j.trip?.summary) throw new Error('valhalla: no route');
  const coordinates = decodePolyline(leg.shape, 6).map(([lat, lon]) => [lon, lat] as [number, number]);
  if (coordinates.length < 2) throw new Error('valhalla: empty shape');
  const steps = (leg.maneuvers ?? [])
    .filter((m) => typeof m.instruction === 'string' && m.instruction.length > 0)
    .map((m) => {
      const at = m.begin_shape_index === undefined ? undefined : coordinates[m.begin_shape_index];
      return {
        instruction: m.instruction as string,
        distanceM: Math.round((m.length ?? 0) * 1000),
        ...(at ? { lat: at[1], lon: at[0] } : {}),
      };
    });
  return {
    source: 'valhalla',
    distanceM: Math.round((j.trip.summary.length ?? 0) * 1000),
    minutes: round1((j.trip.summary.time ?? 0) / 60),
    coordinates,
    steps,
    approximate: false,
  };
}

interface OsrmStep {
  distance?: number;
  name?: string;
  maneuver?: { type?: string; modifier?: string; location?: [number, number] };
}
interface OsrmResponse {
  code?: string;
  routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] }; legs?: { steps?: OsrmStep[] }[] }[];
}

function osrmInstruction(s: OsrmStep): string {
  const type = s.maneuver?.type ?? '';
  const mod = s.maneuver?.modifier;
  const onto = s.name ? ` onto ${s.name}` : '';
  if (type === 'depart') return `Head ${mod ?? 'out'}${s.name ? ` on ${s.name}` : ''}`;
  if (type === 'arrive') return 'Arrive at your destination';
  if (mod === 'straight') return `Continue straight${onto}`;
  if (mod) return `Turn ${mod}${onto}`;
  return `Continue${onto}`;
}

export async function fromOsrm(
  from: LatLon,
  to: LatLon,
  deps: WalkDeps = {},
  profile: 'foot' | 'car' = 'foot',
): Promise<WalkResult> {
  const base = profile === 'car' ? OSRM_CAR_URL : OSRM_URL;
  const url = `${base}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const j = (await getJson(url, deps)) as OsrmResponse;
  const r = j.routes?.[0];
  const coordinates = r?.geometry?.coordinates;
  if (j.code !== 'Ok' || !r || !coordinates || coordinates.length < 2) throw new Error('osrm: no route');
  const distanceM = Math.round(r.distance ?? 0);
  const steps = (r.legs?.[0]?.steps ?? []).map((s) => {
    const at = s.maneuver?.location; // [lon, lat]
    return {
      instruction: osrmInstruction(s),
      distanceM: Math.round(s.distance ?? 0),
      ...(at ? { lat: at[1], lon: at[0] } : {}),
    };
  });
  return {
    source: 'osrm',
    distanceM,
    // OSRM foot assumes walking pace; use the slower wheelchair pace when it gives more time.
    minutes: round1((profile === 'car' ? (r.duration ?? 0) : Math.max(r.duration ?? 0, distanceM / WHEELCHAIR_MPS)) / 60),
    coordinates,
    steps,
    // Foot routes ignore curb ramps and slopes; car routes follow real roads (time has no live traffic).
    approximate: profile !== 'car',
  };
}

export function straightLine(from: LatLon, to: LatLon): WalkResult {
  const distanceM = Math.round(haversineM(from, to));
  return {
    source: 'straight',
    distanceM,
    minutes: round1(distanceM / WHEELCHAIR_MPS / 60),
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    steps: [
      {
        instruction: `Head ${compass(from, to)} toward your destination (straight-line estimate, no sidewalk data)`,
        distanceM,
        lat: from.lat,
        lon: from.lon,
      },
    ],
    approximate: true,
  };
}

// ---------- cache ----------
interface CacheEntry {
  result: WalkResult;
  fetchedAt: number;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export function walkCacheKey(from: LatLon, to: LatLon): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(from.lat)},${r(from.lon)};${r(to.lat)},${r(to.lon)}`;
}

export function clearWalkCache(): void {
  cache.clear();
}

export interface WalkLookup {
  result: WalkResult;
  fromCache: boolean;
  fetchedAt: number; // ms epoch
}

/** Valhalla -> OSRM -> straight line, with the in-memory cache. Never throws. */
export async function getWalk(from: LatLon, to: LatLon, deps: WalkDeps = {}): Promise<WalkLookup> {
  const now = deps.now ?? Date.now;
  const key = walkCacheKey(from, to);
  if (!deps.noCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return { result: hit.result, fromCache: true, fetchedAt: hit.fetchedAt };
    if (hit) cache.delete(key);
  }

  let result: WalkResult;
  try {
    result = await fromValhalla(from, to, deps);
  } catch {
    try {
      result = await fromOsrm(from, to, deps);
    } catch {
      result = straightLine(from, to);
    }
  }

  const fetchedAt = now();
  if (!deps.noCache) {
    const ttl = result.source === 'straight' ? STRAIGHT_TTL_MS : CACHE_TTL_MS;
    cache.set(key, { result, fetchedAt, expiresAt: fetchedAt + ttl });
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  return { result, fromCache: false, fetchedAt };
}

export async function walkRoute(from: LatLon, to: LatLon, deps: WalkDeps = {}): Promise<WalkResult> {
  return (await getWalk(from, to, deps)).result;
}
