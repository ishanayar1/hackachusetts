// Framework-agnostic glue shared by the /api/route and /api/station handlers and the MCP server.
import { ALERTS_PATH, closedFacilityIds, normalizeAlerts, type ParentOf } from '@/lib/mbta/alerts';
import { mbtaGet, type MbtaResult } from '@/lib/mbta/client';
import type { NormalizedAlert } from '@/lib/mbta/types';
import { planStepFree, stationStatus, type RouteResult } from '@/lib/router';
import { FACILITY_ID_RE, type FullStaticData } from '@/lib/static-data-fs';

export function parentOfFromStatic(data: FullStaticData): ParentOf {
  const m = new Map<string, string>();
  for (const p of Object.values(data.network.platforms)) m.set(p.id, p.stationId);
  for (const s of data.stations) for (const id of [...s.platformIds, ...s.entranceIds]) m.set(id, s.id);
  return (id) => m.get(id) ?? (id.startsWith('place-') ? id : undefined);
}

export type LiveAlerts = { alerts: NormalizedAlert[]; closedFacilityIds: string[]; result: MbtaResult };

export async function getLiveAlerts(parentOf: ParentOf, fallback?: () => Promise<unknown>): Promise<LiveAlerts> {
  const result = await mbtaGet(ALERTS_PATH, { ttlMs: 30_000, fallback });
  const now = new Date();
  const alerts = normalizeAlerts(result.body, parentOf, now);
  return { alerts, closedFacilityIds: closedFacilityIds(alerts, now), result };
}

/**
 * Live alerts, or the demo snapshot's closures (source 'demo') when live alerts cannot be loaded at all,
 * so /api/route and the station screens degrade to demo data instead of a 503.
 * Throws only when the demo snapshot is unavailable too.
 */
export async function getAlertsOrDemo(
  parentOf: ParentOf,
  demo: () => Promise<unknown>,
  live: () => Promise<LiveAlerts> = () => getLiveAlerts(parentOf, demo),
): Promise<LiveAlerts> {
  try {
    return await live();
  } catch {
    // fall through to the demo snapshot
  }
  const body = await demo();
  const now = new Date();
  const alerts = normalizeAlerts(body, parentOf, now);
  return { alerts, closedFacilityIds: closedFacilityIds(alerts, now), result: { body, source: 'demo', fetchedAt: now.getTime() } };
}

/** Parse "id1,id2" into validated facility ids. Returns null when any id is malformed. */
export function parseClosedParam(raw: string | null | undefined): string[] | null {
  if (!raw) return [];
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length > 50 || !ids.every((id) => FACILITY_ID_RE.test(id))) return null;
  return ids;
}

export type PlannedRoute = RouteResult & { closedFacilityIds: string[] };

export function planWithClosures(data: FullStaticData, from: string, to: string, live: string[], extra: string[]): PlannedRoute {
  const closed = [...new Set([...live, ...extra])].sort();
  return { ...planStepFree(data, { from, to, closed: new Set(closed) }), closedFacilityIds: closed };
}

export function stationDetail(data: FullStaticData, stationId: string, alerts: NormalizedAlert[], closedIds: string[]) {
  const station = data.stationById.get(stationId);
  if (!station) return null;
  const closed = new Set(closedIds);
  const facilityIds = new Set(station.facilityIds);
  const facilities = data.facilities
    .filter((f) => f.stationId === stationId || facilityIds.has(f.id))
    .map((f) => ({ ...f, closed: closed.has(f.id) }));
  const here = new Set(facilities.map((f) => f.id));
  return {
    station,
    facilities,
    status: stationStatus(data, stationId, closed),
    parking: data.parking.filter((p) => p.stationId === stationId),
    alerts: alerts.filter((a) => a.stationIds.includes(stationId) || a.facilityIds.some((f) => here.has(f))),
  };
}
