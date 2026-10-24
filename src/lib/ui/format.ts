// Plain-words formatting helpers for the panel. Pure functions.
import type {
  BlockedPlatform,
  CrashHex,
  CrashSpot,
  MapLayerToggles,
  NormalizedAlert,
  Prediction,
  Station,
  StationStatusRow,
} from './api';

export const ROUTE_NAMES: Record<string, string> = {
  Red: 'Red Line',
  Orange: 'Orange Line',
  Blue: 'Blue Line',
  'Green-B': 'Green Line B branch',
  'Green-C': 'Green Line C branch',
  'Green-D': 'Green Line D branch',
  'Green-E': 'Green Line E branch',
  Mattapan: 'Mattapan Trolley',
};
export const ROUTE_COLORS: Record<string, string> = {
  Red: '#DA291C',
  Orange: '#ED8B00',
  Blue: '#003DA5',
  'Green-B': '#00843D',
  'Green-C': '#00843D',
  'Green-D': '#00843D',
  'Green-E': '#00843D',
  Mattapan: '#DA291C',
};
export const routeName = (r: string) => ROUTE_NAMES[r] ?? r;

/**
 * Map / legend status: 'yes' step-free now, 'partial' some platform (direction) blocked but at least one
 * works, 'no' not step-free now, 'unknown' no data.
 */
export type StepFreeState = 'yes' | 'partial' | 'no' | 'unknown';

type LiveStatus = Pick<StationStatusRow, 'stepFree' | 'approximate' | 'blockedBy' | 'partial'>;

/** Partly step-free: server flag when present, else "step-free but something on a step-free path is closed". */
export function isPartial(live: LiveStatus | undefined): boolean {
  if (!live || !live.stepFree) return false;
  return live.partial ?? (live.blockedBy?.length ?? 0) > 0;
}

export function stepFreeState(station: Station, live: LiveStatus | undefined): StepFreeState {
  if (live) {
    if (live.stepFree) return isPartial(live) ? 'partial' : 'yes';
    if (live.approximate && station.wheelchair === 0) return 'unknown';
    return 'no';
  }
  if (station.wheelchair === 1) return 'yes';
  if (station.wheelchair === 2) return 'no';
  return 'unknown';
}

export const STATE_TEXT: Record<StepFreeState, string> = {
  yes: 'Step-free now',
  partial: 'Partly step-free now',
  no: 'Not step-free right now',
  unknown: 'No step-free data',
};

/**
 * "Partly step-free: Wonderland platform blocked by Revere Beach Elevator 885" (one line per blocked platform).
 * Falls back to the station's blockedBy list when the server does not send blockedPlatforms.
 */
export function partialLines(
  blockedPlatforms: BlockedPlatform[] | undefined,
  blockedBy: string[],
  facilityName: (id: string) => string,
): string[] {
  const rows = blockedPlatforms ?? [];
  if (rows.length > 0) {
    return rows.map((p) => {
      const name = (p.name ?? '').trim();
      const platform = !name ? 'One platform' : /platform/i.test(name) ? name : `${name} platform`;
      const by = (p.facilityIds ?? []).map(facilityName);
      return `Partly step-free: ${platform} blocked${by.length ? ` by ${by.join(', ')}` : ''}`;
    });
  }
  if (blockedBy.length > 0) return [`Partly step-free: one platform blocked by ${blockedBy.map(facilityName).join(', ')}`];
  return ['Partly step-free: one platform has no step-free path right now'];
}

/** "door-dwnxg-101arch" -> "101 Arch entrance". Used when pathways names are not loaded. */
export function cleanEntranceId(id: string, kind: 'entrance' | 'exit' = 'entrance'): string {
  const parts = id.split('-');
  let rest = parts[0] === 'door' && parts.length > 2 ? parts.slice(2).join(' ') : parts.join(' ');
  let elevator = false;
  if (/elev$/i.test(rest)) {
    elevator = true;
    rest = rest.replace(/elev$/i, '');
  }
  rest = rest
    .replace(/(\d)([a-z])/gi, '$1 $2')
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  if (!rest) return kind === 'entrance' ? 'Accessible entrance' : 'Accessible exit';
  return `${rest} ${kind}${elevator ? ' (elevator)' : ''}`;
}

const NY = 'America/New_York';
const nyYear = (d: Date) => d.toLocaleString('en-US', { year: 'numeric', timeZone: NY });

/** "Oct 24, 1:30 PM"; adds the year when it is not the current year ("Mar 15, 2022, 10:13 AM"). */
export function formatTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(nyYear(d) !== nyYear(now) ? { year: 'numeric' as const } : {}),
    hour: 'numeric',
    minute: '2-digit',
    timeZone: NY,
  });
}

/** MBTA sends Unix-epoch placeholder periods for alerts with no announced dates. */
const PLACEHOLDER_BEFORE = Date.parse('1970-01-02T12:00:00Z');

/** false when the alert's dates are placeholders (server flag, or an epoch start from an older server). */
export function alertDatesKnown(a: Pick<NormalizedAlert, 'datesKnown' | 'activePeriods'>): boolean {
  if (a.datesKnown !== undefined) return a.datesKnown;
  const start = a.activePeriods?.[0]?.start;
  const t = start ? Date.parse(start) : NaN;
  return !(Number.isFinite(t) && t < PLACEHOLDER_BEFORE);
}

/** Active now. An alert without announced dates counts as active unless MBTA says it is upcoming. */
export function alertActive(a: Pick<NormalizedAlert, 'activeNow' | 'datesKnown' | 'activePeriods' | 'lifecycle'>): boolean {
  return a.activeNow || (!alertDatesKnown(a) && a.lifecycle !== 'UPCOMING');
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

export type TrainGroup = { key: string; routeId: string; directionId: 0 | 1; trains: Prediction[] };

/**
 * Next trains per route + direction (subway only), the next `perGroup` in each, groups ordered by their
 * soonest train. Replaces a global top-N, which hid whole lines at busy stations.
 */
export function nextTrainGroups(preds: readonly Prediction[], perGroup = 2): TrainGroup[] {
  const groups = new Map<string, TrainGroup>();
  const sorted = preds
    .filter((p) => p.routeId in ROUTE_NAMES && Number.isFinite(p.minutesAway))
    .slice()
    .sort((a, b) => a.minutesAway - b.minutesAway || a.time.localeCompare(b.time));
  for (const p of sorted) {
    const key = `${p.routeId}|${p.directionId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, routeId: p.routeId, directionId: p.directionId, trains: [] }));
    if (g.trains.length < perGroup) g.trains.push(p);
  }
  return [...groups.values()];
}

export function minutesText(t: Pick<Prediction, 'minutesAway' | 'approximate'>): string {
  return t.minutesAway === 0 ? 'now' : `${t.approximate ? 'about ' : ''}${t.minutesAway} min`;
}

/** "any Green Line B, C or D train" when several branches serve a leg, else "the Red Line". */
export function legRoutesText(route: string, alsoRoutes: readonly string[] | undefined): string {
  const all = [...new Set([route, ...(alsoRoutes ?? [])])];
  if (all.length < 2) return `the ${routeName(route)}`;
  const join = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
  if (all.every((r) => /^Green-[A-Z]$/.test(r))) {
    return `any Green Line ${join(all.map((r) => r.slice(-1)).sort())} train`;
  }
  return `any ${join(all.map(routeName))} train`;
}

export const ACCESS_EFFECTS = new Set(['ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'ACCESS_ISSUE']);

export function effectLabel(effect: string): string {
  switch (effect) {
    case 'ELEVATOR_CLOSURE':
      return 'Elevator out of service';
    case 'ESCALATOR_CLOSURE':
      return 'Escalator out of service';
    case 'ACCESS_ISSUE':
      return 'Access issue';
    case 'SHUTTLE':
      return 'Shuttle buses';
    case 'SUSPENSION':
      return 'Service suspended';
    case 'STATION_CLOSURE':
      return 'Station closed';
    case 'STATION_ISSUE':
      return 'Station issue';
    case 'DELAY':
      return 'Delays';
    case 'DETOUR':
      return 'Detour';
    case 'NOTICE':
      return 'Notice';
    default:
      return effect
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

export function facilityTypeWord(type: string): string {
  switch (type) {
    case 'ELEVATOR':
      return 'elevator';
    case 'ESCALATOR':
      return 'escalator';
    case 'RAMP':
      return 'ramp';
    case 'PORTABLE_BOARDING_LIFT':
      return 'portable boarding lift';
    case 'BRIDGE_PLATE':
      return 'bridge plate';
    case 'ELEVATED_SUBPLATFORM':
      return 'mini-high platform';
    default:
      return 'facility';
  }
}

// ---------------------------------------------------------------- crash layer

export type CrashMode = 'recorded' | 'model' | 'off';

/** Bins for recorded pedestrian + bike crashes per intersection (top 25% / 6% / 1.5% start at 2 / 5 / 10). */
export const RECORDED_BINS = [
  { min: 0, label: '0 to 1 recorded', color: '#fee391' },
  { min: 2, label: '2 to 4 recorded', color: '#fdae61' },
  { min: 5, label: '5 to 9 recorded', color: '#e8590c' },
  { min: 10, label: '10 or more recorded', color: '#9e1a1a' },
];
/** Bins for the team model's estimate per intersection (risk_yr; top 15% / 8% / 2% start at 0.5 / 1 / 2). */
export const MODEL_BINS = [
  { min: 0, label: 'Under 0.5 a year', color: '#e9d8fd' },
  { min: 0.5, label: '0.5 to 1 a year', color: '#facc15' },
  { min: 1, label: '1 to 2 a year', color: '#f97316' },
  { min: 2, label: '2 or more a year', color: '#dc2626' },
];

/** The map opens clean: crash layer off (one tap away in Layers), live trains on. */
export const DEFAULT_CRASH_MODE: CrashMode = 'off';
export const MODEL_MIN_SHOWN = MODEL_BINS[1].min;
export const DEFAULT_LAYERS: MapLayerToggles = {
  trains: true,
  fatal: false,
  danger: false,
  equity: false,
  ramps: false,
  // The one optional layer on by default: step-free equipment is what this app is for.
  access: true,
};

/** MapLibre filter for the crash layer: the model hides intersections under MODEL_MIN_SHOWN a year. */
export function crashFilter(mode: CrashMode): unknown[] | undefined {
  return mode === 'model' ? ['>=', ['get', 'risk_yr'], MODEL_MIN_SHOWN] : undefined;
}

export function binLabel(value: number, bins: { min: number; label: string }[]): string {
  let out = bins[0].label;
  for (const b of bins) if (value >= b.min) out = b.label;
  return out;
}

/** GeoJSON feature properties (from crash-risk.geojson) -> CrashHex. */
export function hexFromProps(p: Record<string, unknown>): CrashHex {
  const n = (k: string) => {
    const v = Number(p[k]);
    return Number.isFinite(v) ? v : 0;
  };
  const ped = n('ped');
  const bike = n('bike');
  return {
    site: String(p.site ?? ''),
    label: String(p.label ?? 'Unnamed intersection'),
    neighborhood: p.neighborhood ? String(p.neighborhood) : '',
    lat: n('lat'),
    lng: n('lng'),
    ped,
    bike,
    pedBike: ped + bike,
    mv: n('mv'),
    total: n('total_crashes'),
    estimatePerYear: n('risk_yr'),
    first: p.first ? String(p.first) : undefined,
    last: p.last ? String(p.last) : undefined,
  };
}

/** Client-side copy of /api/crash/locations, used when the API is not reachable. */
export function crashSpotsFromGeojson(
  fc: GeoJSON.FeatureCollection | undefined,
  q: string,
  sort: 'recorded' | 'model',
  limit = 50,
): CrashSpot[] {
  if (!fc) return [];
  const needle = q.trim().toLowerCase();
  const rows = fc.features
    .map((f) => hexFromProps((f.properties ?? {}) as Record<string, unknown>))
    .filter((h) => !needle || h.label.toLowerCase().includes(needle) || h.neighborhood.toLowerCase().includes(needle));
  rows.sort((a, b) =>
    sort === 'model' ? b.estimatePerYear - a.estimatePerYear : b.pedBike - a.pedBike || b.total - a.total,
  );
  return rows.slice(0, limit);
}
