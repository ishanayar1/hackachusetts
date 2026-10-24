// Plain-words formatting helpers for the panel. Pure functions.
import type { CrashHex, CrashSpot, Station, StationStatusRow } from './api';

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

/** Map / legend status: 'yes' step-free now, 'no' not step-free now, 'unknown' no data. */
export type StepFreeState = 'yes' | 'no' | 'unknown';

export function stepFreeState(station: Station, live: StationStatusRow | undefined): StepFreeState {
  if (live) {
    if (live.stepFree) return 'yes';
    if (live.approximate && station.wheelchair === 0) return 'unknown';
    return 'no';
  }
  if (station.wheelchair === 1) return 'yes';
  if (station.wheelchair === 2) return 'no';
  return 'unknown';
}

export const STATE_TEXT: Record<StepFreeState, string> = {
  yes: 'Step-free now',
  no: 'Not step-free right now',
  unknown: 'No step-free data',
};

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

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
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
    default:
      return 'facility';
  }
}

// ---------------------------------------------------------------- crash layer

export type CrashMode = 'recorded' | 'model' | 'off';

/** Bins for recorded pedestrian + bike crashes per hex (about the 50th / 75th / 90th percentiles). */
export const RECORDED_BINS = [
  { min: 0, label: '0 to 4 recorded', color: '#fee391' },
  { min: 5, label: '5 to 12 recorded', color: '#fdae61' },
  { min: 13, label: '13 to 29 recorded', color: '#e8590c' },
  { min: 30, label: '30 or more recorded', color: '#9e1a1a' },
];
/** Bins for the team model's estimate (risk_yr, crashes per year at the next-month rate). */
export const MODEL_BINS = [
  { min: 0, label: 'Under 2 a year', color: '#e9d8fd' },
  { min: 2, label: '2 to 5 a year', color: '#b197fc' },
  { min: 5, label: '5 to 10 a year', color: '#7048e8' },
  { min: 10, label: '10 or more a year', color: '#3b1a8c' },
];

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
    hex: String(p.hex ?? ''),
    label: String(p.label ?? 'Unnamed area'),
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
    .filter((h) => !needle || h.label.toLowerCase().includes(needle));
  rows.sort((a, b) =>
    sort === 'model' ? b.estimatePerYear - a.estimatePerYear : b.pedBike - a.pedBike || b.total - a.total,
  );
  return rows.slice(0, limit);
}
