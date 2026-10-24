// Client-side walking helpers: /api/walk contract types, wording, nearest station, geolocation.
import type { Station, StationStatusRow } from './api';
import { stepFreeState } from './format';

export type WalkWarnings = {
  crashAreas: { site: string; label: string; pedBike: number }[];
  /** Capped list; hazardTotal is the uncapped count. */
  hazards: { id: string; type: string; label: string; openedAt: string; lat: number; lon: number }[];
  /** Capped list of ramps in poor condition and/or with a lip at the edge (read `condition`). */
  poorRamps: { id: string; condition: string; lat: number; lon: number }[];
  hazardTotal?: number;
  rampTotal?: number;
  poorRampTotal?: number;
  lipOnlyRampTotal?: number;
  /** Vision Zero resident reports near the walk (capped list; safetyConcernTotal is the full count). */
  safetyConcerns?: { concern: string; date: string }[];
  safetyConcernTotal?: number;
  /** Recorded fatal crashes near the walk, newest first (capped list; fatalTotal is the full count). */
  fatalCrashes?: { date: string; mode: string; label: string }[];
  fatalTotal?: number;
};

export type WalkResult = {
  source: 'valhalla' | 'osrm' | 'straight';
  distanceM: number;
  minutes: number;
  coordinates: [number, number][]; // [lon, lat]
  /** lat/lon: where the step starts (absent on older cached routes). */
  steps: { instruction: string; distanceM: number; lat?: number; lon?: number }[];
  approximate: boolean;
  warnings?: WalkWarnings;
};

export type LatLon = { lat: number; lon: number };
export type Place = LatLon & { label: string };

/** Demo start point: Park Street, Boston Common side. */
export const DEMO_PLACE: Place = { lat: 42.3564, lon: -71.0621, label: 'Park Street (pretend location)' };

export const WALK_SOURCE_LABEL: Record<WalkResult['source'], string> = {
  valhalla: 'Wheelchair route (Valhalla)',
  osrm: 'Walking route (OSRM), approximate',
  straight: 'Straight line, approximate',
};

export function walkUrl(from: LatLon, to: LatLon): string {
  const f = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  return `/api/walk?from=${f(from)}&to=${f(to)}`;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Plain-text warning lines (never "safe", crash data is "recorded crashes"). */
export function warningLines(w: WalkWarnings | undefined): string[] {
  if (!w) return [];
  const out: string[] = [];
  for (const c of w.crashAreas ?? []) {
    if (!(c.pedBike > 0)) continue;
    out.push(`Passes ${c.label}: ${c.pedBike} recorded pedestrian & bike ${c.pedBike === 1 ? 'crash' : 'crashes'} since 2015`);
  }
  const hazards = w.hazards ?? [];
  for (const h of hazards) {
    out.push(`${h.label} (311, open since ${formatDay(h.openedAt)})`);
  }
  const moreHazards = (w.hazardTotal ?? hazards.length) - hazards.length;
  if (moreHazards > 0) {
    out.push(`And ${moreHazards} more open 311 ${moreHazards === 1 ? 'report' : 'reports'} along this walk`);
  }
  const ramps = w.poorRamps ?? [];
  const poor = w.poorRampTotal ?? ramps.filter((r) => /poor/i.test(r.condition ?? '')).length;
  const lip = w.lipOnlyRampTotal ?? ramps.filter((r) => /lip/i.test(r.condition ?? '') && !/poor/i.test(r.condition ?? '')).length;
  const parts: string[] = [];
  if (poor > 0) parts.push(`${poor} curb ${poor === 1 ? 'ramp' : 'ramps'} in poor condition`);
  if (lip > 0) parts.push(`${lip}${poor > 0 ? '' : ` curb ${lip === 1 ? 'ramp' : 'ramps'}`} with a lip at the edge`);
  if (parts.length) out.push(`${parts.join(', ')} near your route`);
  const fatal = w.fatalCrashes ?? [];
  for (const f of fatal) {
    const year = /^\d{4}/.test(f.date ?? '') ? f.date.slice(0, 4) : 'an unknown year';
    out.push(`Fatal crash recorded here in ${year} (${f.mode || 'mode not recorded'})${f.label ? `: ${f.label}` : ''}`);
  }
  const moreFatal = (w.fatalTotal ?? fatal.length) - fatal.length;
  if (moreFatal > 0) out.push(`And ${moreFatal} more recorded fatal ${moreFatal === 1 ? 'crash' : 'crashes'} along this walk`);
  const concerns = w.safetyConcerns ?? [];
  for (const c of concerns) out.push(`Residents reported ${c.concern} here (${formatYmd(c.date)})`);
  const moreConcerns = (w.safetyConcernTotal ?? concerns.length) - concerns.length;
  if (moreConcerns > 0) {
    out.push(`And ${moreConcerns} more resident ${moreConcerns === 1 ? 'report' : 'reports'} along this walk`);
  }
  return out;
}

/** "2023-11-27" -> "Nov 27, 2023" without a UTC shift (new Date("2023-11-27") is midnight UTC = the 26th in Boston). */
export function formatYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Demo destinations for "End at a place". Coordinates are the main public entrance / gate. */
export const DEMO_DESTINATIONS: Place[] = [
  { label: 'Boston Public Library (Copley)', lat: 42.34935, lon: -71.07816 },
  { label: 'Mass General Hospital', lat: 42.36268, lon: -71.06876 },
  { label: 'Fenway Park', lat: 42.34668, lon: -71.09723 },
  { label: 'Harvard Yard', lat: 42.37443, lon: -71.11693 },
];

export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Closest station that is step-free now (falls back to closest of any state). */
export function nearestStepFree(
  p: LatLon,
  stations: Station[],
  live: Map<string, StationStatusRow>,
): Station | undefined {
  let best: Station | undefined;
  let bestD = Infinity;
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const st = stepFreeState(s, live.get(s.id));
    if (st !== 'yes' && st !== 'partial') continue;
    const d = haversineM(p, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Ask the browser for the current position. Resolves with a Place or rejects with a user-facing message. */
export function getMyLocation(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('This browser cannot share your location. Pick a station instead.'));
      return;
    }
    if (!window.isSecureContext) {
      reject(new Error('Location only works over a secure (https) connection. Pick a station instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Your location' }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Pick a station or use the Park Street demo instead.'
              : 'We could not get your location. Try again, or pick a station instead.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
