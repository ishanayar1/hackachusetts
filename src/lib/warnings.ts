// Walking-route warnings: recorded crashes near the line, open 311 hazards, and curb ramps in poor
// condition or with a lip. Pure and framework-agnostic except loadWarningDataFromDisk (node:fs).
// Wording rule (docs/lastmile-plan.md): crash data is "recorded crashes"; never call a route "safe".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toCrashSpots, type CrashSpot } from './crash';

export type Hazard = { id: string; type: string; label: string; openedAt: string; lat: number; lon: number };
export type Ramp = { id: string; condition: string; lat: number; lon: number };
export type WarningData = { crashSpots: CrashSpot[]; hazards: Hazard[]; ramps: Ramp[] };
export type WalkWarnings = {
  crashAreas: { site: string; label: string; pedBike: number }[];
  /** Nearest hazards, capped at MAX_HAZARDS; hazardTotal is the uncapped count (after de-duplication). */
  hazards: Hazard[];
  /** Nearest ramps that are poor condition and/or lipped, capped at MAX_RAMPS; read `condition` per item. */
  poorRamps: { id: string; condition: string; lat: number; lon: number }[];
  hazardTotal: number;
  /** All flagged ramps near the line (poor condition or lip at edge). */
  rampTotal: number;
  /** Ramps whose condition is poor (with or without a lip). */
  poorRampTotal: number;
  /** Ramps flagged only for a lip at the edge (city condition not poor). */
  lipOnlyRampTotal: number;
};

// Crash spots are intersection points (crash-risk.geojson), so they must sit on the walk itself.
export const CRASH_RADIUS_M = 60;
export const MAX_CRASH_AREAS = 5;
export const MAX_HAZARDS = 10;
export const MAX_RAMPS = 10;
/** 311 cases older than this (by openedAt, at request time) are no longer shown. */
export const HAZARD_MAX_AGE_DAYS = 120;
/** Separate 311 cases with the same type and label, opened the same day, within this distance are one hazard. */
export const HAZARD_DUP_RADIUS_M = 15;

const DAY_MS = 86_400_000;

export function isPoorRamp(condition: string | undefined): boolean {
  return /poor/i.test(condition ?? '');
}
export function isLipOnlyRamp(condition: string | undefined): boolean {
  return /lip/i.test(condition ?? '') && !isPoorRamp(condition);
}

const M_PER_DEG_LAT = 111_320;

/**
 * Distance in meters from point (lon, lat) to a polyline of [lon, lat] coordinates, using an
 * equirectangular projection centred on the point (accurate to well under 1% at walking scale).
 */
export function distanceToLineM(lon: number, lat: number, coords: readonly [number, number][]): number {
  if (coords.length === 0) return Infinity;
  const kx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const ky = M_PER_DEG_LAT;
  const px = (c: [number, number]) => (c[0] - lon) * kx;
  const py = (c: [number, number]) => (c[1] - lat) * ky;
  if (coords.length === 1) return Math.hypot(px(coords[0]), py(coords[0]));
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = px(coords[i]);
    const ay = py(coords[i]);
    const bx = px(coords[i + 1]);
    const by = py(coords[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Project the origin (the point) onto segment AB.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

function validCoords(coords: readonly unknown[]): [number, number][] {
  return coords.filter(
    (c): c is [number, number] =>
      Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
}

/** Bounding box of the line padded by `padM` meters, for a cheap pre-filter. */
function bbox(coords: [number, number][], padM: number) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const dLat = padM / M_PER_DEG_LAT;
  const dLon = padM / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)));
  return (lon: number, lat: number) =>
    lon >= minLon - dLon && lon <= maxLon + dLon && lat >= minLat - dLat && lat <= maxLat + dLat;
}

export function walkWarnings(
  coords: [number, number][],
  data: Partial<WarningData> | null | undefined,
  opts: { radiusM?: number; now?: number } = {},
): WalkWarnings {
  const radiusM = opts.radiusM ?? 40;
  const now = opts.now ?? Date.now();
  const line = validCoords(coords ?? []);
  const empty: WalkWarnings = {
    crashAreas: [],
    hazards: [],
    poorRamps: [],
    hazardTotal: 0,
    rampTotal: 0,
    poorRampTotal: 0,
    lipOnlyRampTotal: 0,
  };
  if (line.length === 0 || !data) return empty;

  const nearCrash = bbox(line, CRASH_RADIUS_M);
  const nearItem = bbox(line, radiusM);

  const crashAreas = (data.crashSpots ?? [])
    .filter(
      (s) =>
        s.pedBike > 0 && nearCrash(s.lng, s.lat) && distanceToLineM(s.lng, s.lat, line) <= CRASH_RADIUS_M,
    )
    .sort((a, b) => b.pedBike - a.pedBike || a.site.localeCompare(b.site))
    .slice(0, MAX_CRASH_AREAS)
    .map((s) => ({ site: s.site, label: s.label, pedBike: s.pedBike }));

  const oldest = now - HAZARD_MAX_AGE_DAYS * DAY_MS;
  const nearHazards: { h: Hazard; d: number }[] = [];
  for (const h of data.hazards ?? []) {
    const opened = Date.parse(h.openedAt);
    if (Number.isFinite(opened) && opened < oldest) continue; // stale snapshot entry
    if (!nearItem(h.lon, h.lat)) continue;
    const d = distanceToLineM(h.lon, h.lat, line);
    if (d <= radiusM) nearHazards.push({ h, d });
  }
  nearHazards.sort((a, b) => a.d - b.d || a.h.id.localeCompare(b.h.id));
  // Merge duplicate 311 cases (same type + label, same day, within HAZARD_DUP_RADIUS_M); keep the nearest.
  const hazardsWithD: { h: Hazard; d: number }[] = [];
  for (const x of nearHazards) {
    const day = (x.h.openedAt ?? '').slice(0, 10);
    const dup = hazardsWithD.some(
      ({ h }) =>
        h.type === x.h.type &&
        h.label === x.h.label &&
        (h.openedAt ?? '').slice(0, 10) === day &&
        distanceToLineM(x.h.lon, x.h.lat, [[h.lon, h.lat]]) <= HAZARD_DUP_RADIUS_M,
    );
    if (!dup) hazardsWithD.push(x);
  }

  const rampsWithD: { r: Ramp; d: number }[] = [];
  for (const r of data.ramps ?? []) {
    if (!nearItem(r.lon, r.lat)) continue;
    const d = distanceToLineM(r.lon, r.lat, line);
    if (d <= radiusM) rampsWithD.push({ r, d });
  }
  rampsWithD.sort((a, b) => a.d - b.d || a.r.id.localeCompare(b.r.id));

  return {
    crashAreas,
    hazards: hazardsWithD.slice(0, MAX_HAZARDS).map((x) => x.h),
    poorRamps: rampsWithD
      .slice(0, MAX_RAMPS)
      .map(({ r }) => ({ id: r.id, condition: r.condition, lat: r.lat, lon: r.lon })),
    hazardTotal: hazardsWithD.length,
    rampTotal: rampsWithD.length,
    poorRampTotal: rampsWithD.filter(({ r }) => isPoorRamp(r.condition)).length,
    lipOnlyRampTotal: rampsWithD.filter(({ r }) => isLipOnlyRamp(r.condition)).length,
  };
}

function readJson(dir: string, file: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  } catch {
    return null;
  }
}

const cache = new Map<string, WarningData>();

/** Server-side loader for public/data/{crash-risk.geojson,hazards.json,ramps.json}. Cached per dir; missing files -> []. */
export function loadWarningDataFromDisk(dir: string): WarningData {
  const hit = cache.get(dir);
  if (hit) return hit;
  const hazards = readJson(dir, 'hazards.json');
  const ramps = readJson(dir, 'ramps.json');
  const data: WarningData = {
    crashSpots: toCrashSpots(readJson(dir, 'crash-risk.geojson')),
    hazards: Array.isArray(hazards) ? (hazards as Hazard[]) : [],
    ramps: Array.isArray(ramps) ? (ramps as Ramp[]) : [],
  };
  cache.set(dir, data);
  return data;
}

/** Test helper: forget cached disk data. */
export function clearWarningDataCache(): void {
  cache.clear();
}
