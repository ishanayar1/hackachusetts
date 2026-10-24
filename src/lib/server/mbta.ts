import 'server-only';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiEnvelope, Prediction } from '@/lib/mbta/types';
import { normalizePredictions } from '@/lib/mbta/live';
import type { MbtaResult } from '@/lib/mbta/client';
import type { ParentOf } from '@/lib/mbta/alerts';

export { mbtaGet, MbtaHttpError } from '@/lib/mbta/client';
export type { MbtaResult } from '@/lib/mbta/client';
export { ALERTS_PATH, normalizeAlerts, closedFacilityIds, isActiveAt, toStationId } from '@/lib/mbta/alerts';
export type { ParentOf } from '@/lib/mbta/alerts';
export {
  normalizePredictions,
  normalizeVehicles,
  predictionsPath,
  VEHICLES_PATH,
  VEHICLES_WITH_BUSES_PATH,
  STOP_ID_RE,
  MAX_PREDICTION_STOPS,
} from '@/lib/mbta/live';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const RELOAD_EMPTY_MS = 60_000;

let parentMap: Map<string, string> | null = null;
let loadedAt = 0;

/* eslint-disable @typescript-eslint/no-explicit-any */
function readJson(file: string): any | null {
  try {
    return JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

function loadParentMap(): Map<string, string> {
  const m = new Map<string, string>();
  const network = readJson('network.json');
  for (const p of Object.values<any>(network?.platforms ?? {})) {
    if (p?.id && p?.stationId) m.set(String(p.id), String(p.stationId));
  }
  const stations = readJson('stations.json');
  if (Array.isArray(stations)) {
    for (const s of stations) {
      for (const id of [...(s?.platformIds ?? []), ...(s?.entranceIds ?? [])]) m.set(String(id), String(s.id));
    }
  }
  return m;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Platform/entrance id -> parent "place-*" id, from public/data (read once; retried while missing). */
export function getParentOf(): ParentOf {
  if (!parentMap || (parentMap.size === 0 && Date.now() - loadedAt > RELOAD_EMPTY_MS)) {
    parentMap = loadParentMap();
    loadedAt = Date.now();
  }
  const m = parentMap;
  return (id) => m.get(id) ?? (id.startsWith('place-') ? id : undefined);
}

const demoCache = new Map<string, unknown>();

/** A demo snapshot from public/data (read once); falls back to fetching it from our own origin. */
export async function loadDemoFile(file: string, origin?: string): Promise<unknown> {
  if (demoCache.has(file)) return demoCache.get(file);
  let body: unknown;
  try {
    body = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    if (!origin) throw new Error(`${file} unavailable`);
    const res = await fetch(`${origin}/data/${file}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`${file} unavailable`);
    body = await res.json();
  }
  demoCache.set(file, body);
  return body;
}

/** Raw V3 alerts snapshot from public/data/demo-alerts.json; falls back to fetching it from our own origin. */
export function loadDemoAlerts(origin?: string): Promise<unknown> {
  return loadDemoFile('demo-alerts.json', origin);
}

/** Raw V3 vehicles snapshot from public/data/demo-vehicles.json. */
export function loadDemoVehicles(origin?: string): Promise<unknown> {
  return loadDemoFile('demo-vehicles.json', origin);
}

/**
 * Predictions from public/data/demo-predictions.json ({ capturedAt, stations: { [placeId]: V3 body } }),
 * normalized as of capture time and shifted forward so the countdowns read as if captured just now.
 * Stations not in the snapshot (or a missing file) give an empty list.
 */
export async function demoPredictions(stops: string[], parentOf: ParentOf, origin?: string): Promise<Prediction[]> {
  type Snap = { capturedAt?: string; stations?: Record<string, unknown> } | null;
  let snap: Snap;
  try {
    snap = (await loadDemoFile('demo-predictions.json', origin)) as Snap;
  } catch {
    return [];
  }
  const capturedMs = Date.parse(snap?.capturedAt ?? '');
  if (!snap?.stations || Number.isNaN(capturedMs)) return [];
  const shift = Math.max(0, Date.now() - capturedMs);
  const want = new Set(stops);
  const out: Prediction[] = [];
  for (const stop of stops) {
    const body = snap.stations[stop];
    if (!body) continue;
    for (const p of normalizePredictions(body, new Date(capturedMs), parentOf)) {
      if (!want.has(p.stationId)) continue;
      out.push({ ...p, time: new Date(Date.parse(p.time) + shift).toISOString() });
    }
  }
  return out.sort((x, y) => Date.parse(x.time) - Date.parse(y.time));
}

/** Result stub for data served from a bundled demo snapshot. */
export function demoResult(): MbtaResult {
  return { body: null, source: 'demo', fetchedAt: Date.now() };
}

export function envelope<T>(data: T, r: MbtaResult): ApiEnvelope<T> {
  return {
    data,
    source: r.source,
    ageSec: Math.max(0, Math.round((Date.now() - r.fetchedAt) / 1000)),
    fetchedAt: new Date(r.fetchedAt).toISOString(),
  };
}

export function jsonWithCache<T>(body: ApiEnvelope<T>, sMaxAge: number, swr: number): Response {
  return Response.json(body, {
    headers: { 'Cache-Control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}` },
  });
}

/** 503 with a generic message. Never includes upstream details that could carry secrets. */
export function unavailable(what: string): Response {
  return Response.json(
    { error: `${what} temporarily unavailable` },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
