// Bluebikes stations near a point, from the public GBFS feed (no key).
// Framework-agnostic: no Next imports. `fetch` is injectable so tests never touch the network.
//
// Real feeds (checked 2026-10-24): gbfs.bluebikes.com/gbfs/gbfs.json lists GBFS 1.1 feeds on gbfs.lyft.com.
//  - station_information: data.stations[] { station_id (UUID string), name, lat, lon, capacity, ... } (628 stations)
//  - station_status: data.stations[] { station_id, num_bikes_available, num_ebikes_available,
//    num_docks_available, is_installed 0|1, is_renting 0|1, is_returning 0|1, last_reported (epoch s) }
//  - num_ebikes_available is a subset of num_bikes_available (never larger in 628 stations), so
//    `bikes` below is every available bike, e-bikes included.
//  - Uninstalled stations carry placeholder values (is_installed 0, last_reported 86400 = Jan 2 1970):
//    they are left out.

import { haversineM, type LatLon } from './walk';

const DISCOVERY_URL = 'https://gbfs.bluebikes.com/gbfs/gbfs.json';
const INFO_TTL_MS = 60 * 60 * 1000;
const STATUS_TTL_MS = 60 * 1000;
const STALE_STATUS_MAX_MS = 10 * 60 * 1000; // serve old counts up to 10 min if GBFS is down
const TIMEOUT_MS = 8000;
export const DEFAULT_RADIUS_M = 400;
export const MAX_RADIUS_M = 2000;
export const MAX_STATIONS = 3;

export interface BikeStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  bikes: number; // all available bikes, e-bikes included
  ebikes: number;
  docks: number;
  renting: boolean;
}
export interface StationInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
export interface StationStatus {
  id: string;
  bikes: number;
  ebikes: number;
  docks: number;
  installed: boolean;
  renting: boolean;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ---------- parsing (pure) ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const stationsOf = (body: unknown): unknown[] =>
  isObj(body) && isObj(body.data) && Array.isArray(body.data.stations) ? body.data.stations : [];

/** Finds a feed URL by name in gbfs.json (English first). */
export function feedUrl(discovery: unknown, name: string): string | null {
  const data = isObj(discovery) && isObj(discovery.data) ? discovery.data : null;
  if (!data) return null;
  const langs = ['en', ...Object.keys(data).filter((k) => k !== 'en')];
  for (const lang of langs) {
    const l = data[lang];
    const feeds = isObj(l) && Array.isArray(l.feeds) ? l.feeds : [];
    for (const f of feeds) {
      if (isObj(f) && f.name === name && typeof f.url === 'string' && f.url.startsWith('https://')) return f.url;
    }
  }
  return null;
}

export function parseStationInfo(body: unknown): StationInfo[] {
  const out: StationInfo[] = [];
  for (const s of stationsOf(body)) {
    if (!isObj(s)) continue;
    const id = typeof s.station_id === 'string' || typeof s.station_id === 'number' ? String(s.station_id) : '';
    const { lat, lon } = s;
    if (!id || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    out.push({ id, name: typeof s.name === 'string' && s.name ? s.name : `Station ${id}`, lat, lon });
  }
  return out;
}

export function parseStationStatus(body: unknown): Map<string, StationStatus> {
  const out = new Map<string, StationStatus>();
  for (const s of stationsOf(body)) {
    if (!isObj(s)) continue;
    const id = typeof s.station_id === 'string' || typeof s.station_id === 'number' ? String(s.station_id) : '';
    if (!id) continue;
    const bikes = count(s.num_bikes_available);
    const installed = s.is_installed === 1 || s.is_installed === true;
    out.set(id, {
      id,
      bikes,
      ebikes: Math.min(bikes, count(s.num_ebikes_available)),
      docks: count(s.num_docks_available),
      installed,
      renting: installed && (s.is_renting === 1 || s.is_renting === true),
    });
  }
  return out;
}

/** Nearest installed stations within `radiusM`, closest first. Stations without a status row are skipped. */
export function nearestStations(
  info: StationInfo[],
  status: Map<string, StationStatus>,
  point: LatLon,
  radiusM = DEFAULT_RADIUS_M,
  limit = MAX_STATIONS,
): BikeStation[] {
  const out: BikeStation[] = [];
  for (const s of info) {
    const st = status.get(s.id);
    if (!st || !st.installed) continue;
    const distanceM = Math.round(haversineM(point, s));
    if (distanceM > radiusM) continue;
    out.push({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      distanceM,
      bikes: st.bikes,
      ebikes: st.ebikes,
      docks: st.docks,
      renting: st.renting,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Radius from the query string: default 400 m, clamped to 50..2000 m. null when not a number. */
export function parseRadius(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return DEFAULT_RADIUS_M;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(50, Math.min(MAX_RADIUS_M, Math.round(n)));
}

// ---------- fetching + cache ----------
let discovery: { info: string; status: string; at: number } | null = null;
let infoCache: { stations: StationInfo[]; at: number } | null = null;
let statusCache: { stations: Map<string, StationStatus>; at: number } | null = null;

export function clearBluebikesCache(): void {
  discovery = null;
  infoCache = null;
  statusCache = null;
}

async function getJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  if (!res.ok) throw new Error(`GBFS ${res.status}`);
  return res.json();
}

async function getFeeds(fetchFn: FetchLike, now: number): Promise<{ info: string; status: string }> {
  if (discovery && now - discovery.at < INFO_TTL_MS) return discovery;
  const body = await getJson(fetchFn, DISCOVERY_URL);
  const info = feedUrl(body, 'station_information');
  const status = feedUrl(body, 'station_status');
  if (!info || !status) throw new Error('GBFS discovery missing station feeds');
  discovery = { info, status, at: now };
  return discovery;
}

export interface BluebikesLookup {
  stations: BikeStation[];
  fromCache: boolean;
  fetchedAt: number; // when the status counts were fetched
}

/** Throws when GBFS fails and there is no usable cached copy. */
export async function getNearbyBikes(
  point: LatLon,
  radiusM = DEFAULT_RADIUS_M,
  opts: { fetch?: FetchLike; now?: number } = {},
): Promise<BluebikesLookup> {
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now();
  let fromCache = true;

  const infoFresh = infoCache && now - infoCache.at < INFO_TTL_MS;
  const statusFresh = statusCache && now - statusCache.at < STATUS_TTL_MS;
  if (!infoFresh || !statusFresh) {
    try {
      const feeds = await getFeeds(fetchFn, now);
      const [infoBody, statusBody] = await Promise.all([
        infoFresh ? null : getJson(fetchFn, feeds.info),
        statusFresh ? null : getJson(fetchFn, feeds.status),
      ]);
      if (infoBody !== null) {
        const stations = parseStationInfo(infoBody);
        if (stations.length === 0) throw new Error('GBFS station_information empty');
        infoCache = { stations, at: now };
      }
      if (statusBody !== null) {
        const stations = parseStationStatus(statusBody);
        if (stations.size === 0) throw new Error('GBFS station_status empty');
        statusCache = { stations, at: now };
        fromCache = false;
      }
    } catch (err) {
      // Station locations rarely change; old counts are only useful for a few minutes.
      if (!infoCache || !statusCache || now - statusCache.at > STALE_STATUS_MAX_MS) throw err;
    }
  }
  if (!infoCache || !statusCache) throw new Error('GBFS unavailable');
  return {
    stations: nearestStations(infoCache.stations, statusCache.stations, point, radiusM),
    fromCache,
    fetchedAt: statusCache.at,
  };
}
