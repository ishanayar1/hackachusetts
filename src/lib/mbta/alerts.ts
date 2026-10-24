// Alert normalization. Pure functions, no I/O.
import type { NormalizedAlert } from './types';

/** Canonical alerts query. ALWAYS keep filter[activity]=ALL (Trap #1: elevator alerts vanish without it). */
export const ALERTS_PATH = '/alerts?filter[route_type]=0,1&filter[activity]=ALL&include=facilities';

export type ParentOf = (stopId: string) => string | undefined;

export const identityParent: ParentOf = (id) => id;

/** Effects that close or impair a facility for step-free travel. */
export const FACILITY_CLOSURE_EFFECTS = new Set([
  'ELEVATOR_CLOSURE',
  'ESCALATOR_CLOSURE',
  'ACCESS_ISSUE',
  'FACILITY_ISSUE',
]);

/** Map any stop id (platform, door, place) to its parent "place-*" id, or undefined. */
export function toStationId(stopId: string, parentOf: ParentOf): string | undefined {
  if (stopId.startsWith('place-')) return stopId;
  const p = parentOf(stopId);
  if (p && p.startsWith('place-')) return p;
  // Entrances look like "door-dwnxg-franklinelev" -> "place-dwnxg".
  const m = /^door-([a-z0-9]+)-/.exec(stopId);
  if (m) return `place-${m[1]}`;
  return undefined;
}

function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function isActiveAt(
  a: Pick<NormalizedAlert, 'activePeriods' | 'lifecycle'>,
  now: Date,
): boolean {
  const t = now.getTime();
  if (!a.activePeriods.length) return a.lifecycle !== 'UPCOMING';
  return a.activePeriods.some((p) => {
    const s = Date.parse(p.start);
    const e = p.end ? Date.parse(p.end) : Infinity;
    return (Number.isNaN(s) || s <= t) && t < e;
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeAlerts(json: any, parentOf: ParentOf = identityParent, now: Date = new Date()): NormalizedAlert[] {
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  const byId = new Map<string, NormalizedAlert>();
  for (const row of rows) {
    if (!row || (row.type && row.type !== 'alert') || !row.id) continue;
    const a = row.attributes ?? {};
    const entities: any[] = Array.isArray(a.informed_entity) ? a.informed_entity : [];
    const stations = new Set<string>();
    const routes = new Set<string>();
    const facilities = new Set<string>();
    const activities = new Set<string>();
    for (const e of entities) {
      if (!e) continue;
      if (typeof e.stop === 'string') {
        const s = toStationId(e.stop, parentOf);
        if (s) stations.add(s);
      }
      if (typeof e.route === 'string') routes.add(e.route);
      if (e.facility != null && e.facility !== '') facilities.add(String(e.facility));
      if (Array.isArray(e.activities)) for (const act of e.activities) activities.add(String(act));
    }
    const header: string = a.header ?? '';
    const alert: NormalizedAlert = {
      id: String(row.id),
      effect: a.effect ?? 'UNKNOWN_EFFECT',
      header,
      shortHeader: a.short_header || header,
      description: a.description || null,
      url: a.url || null,
      severity: typeof a.severity === 'number' ? a.severity : 0,
      lifecycle: a.lifecycle ?? 'ONGOING',
      activePeriods: (Array.isArray(a.active_period) ? a.active_period : [])
        .filter((p: any) => p && p.start)
        .map((p: any) => ({ start: String(p.start), end: p.end ? String(p.end) : null })),
      activeNow: false,
      stationIds: uniq(stations),
      routeIds: uniq(routes),
      facilityIds: uniq(facilities),
      activities: uniq(activities),
      updatedAt: a.updated_at ?? a.created_at ?? '',
    };
    alert.activeNow = isActiveAt(alert, now);
    const dup = byId.get(alert.id);
    if (dup) {
      // Same id twice: keep the first copy and merge its informed entities.
      dup.stationIds = uniq([...dup.stationIds, ...alert.stationIds]);
      dup.routeIds = uniq([...dup.routeIds, ...alert.routeIds]);
      dup.facilityIds = uniq([...dup.facilityIds, ...alert.facilityIds]);
      dup.activities = uniq([...dup.activities, ...alert.activities]);
      continue;
    }
    byId.set(alert.id, alert);
  }
  return [...byId.values()].sort(
    (x, y) => Number(y.activeNow) - Number(x.activeNow) || y.severity - x.severity || x.id.localeCompare(y.id),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Facility ids (elevators, escalators, ramps, lifts) closed or impaired right now, deduped and sorted. */
export function closedFacilityIds(alerts: NormalizedAlert[], now: Date = new Date()): string[] {
  const out = new Set<string>();
  for (const a of alerts) {
    if (!a.facilityIds.length || !isActiveAt(a, now)) continue;
    if (FACILITY_CLOSURE_EFFECTS.has(a.effect) || a.activities.includes('USING_WHEELCHAIR')) {
      for (const f of a.facilityIds) out.add(f);
    }
  }
  return [...out].sort();
}
