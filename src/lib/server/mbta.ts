import 'server-only';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiEnvelope } from '@/lib/mbta/types';
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

/** Raw V3 alerts snapshot from public/data/demo-alerts.json; falls back to fetching it from our own origin. */
export async function loadDemoAlerts(origin?: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, 'demo-alerts.json'), 'utf8'));
  } catch {
    if (!origin) throw new Error('demo alerts unavailable');
    const res = await fetch(`${origin}/data/demo-alerts.json`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('demo alerts unavailable');
    return res.json();
  }
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
