// Builds the static LastMile data files in public/data/ from MBTA GTFS static.
// Run: npx tsx scripts/build-gtfs.ts   (add --force to re-download)
// No API key is needed: the GTFS zip is on the public CDN.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from 'csv-parse/sync';
import {
  SUBWAY_ROUTES,
  type Facility,
  type FacilityType,
  type Network,
  type NodeKind,
  type ParkingLot,
  type PathwayEdge,
  type PathwayMode,
  type Platform,
  type RideEdge,
  type RouteId,
  type Station,
  type StationPathways,
  type Wheelchair,
} from '../src/lib/mbta/types';

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const ZIP_PATH = path.join(RAW_DIR, 'MBTA_GTFS.zip');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const GTFS_URL = 'https://cdn.mbta.com/MBTA_GTFS.zip';
const MAX_AGE_MS = 24 * 3600 * 1000;

type Row = Record<string, string>;
const SUBWAY = new Set<string>(SUBWAY_ROUTES);
const FACILITY_TYPES: Record<string, FacilityType> = {
  elevator: 'ELEVATOR',
  escalator: 'ESCALATOR',
  ramp: 'RAMP',
  'portable-boarding-lift': 'PORTABLE_BOARDING_LIFT',
  'bridge-plate': 'BRIDGE_PLATE',
};

async function getZip(): Promise<Uint8Array> {
  const force = process.argv.includes('--force');
  if (!force && existsSync(ZIP_PATH) && Date.now() - statSync(ZIP_PATH).mtimeMs < MAX_AGE_MS) {
    console.log(`Reusing ${path.relative(ROOT, ZIP_PATH)}`);
    return readFileSync(ZIP_PATH);
  }
  console.log(`Downloading ${GTFS_URL} ...`);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(ZIP_PATH, buf);
  return buf;
}

function csv(text: string): Row[] {
  return parse(text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Row[];
}

/** Parse only the rows whose first column is in `keys` (fast path for huge files). */
function csvFiltered(text: string, keys: Set<string>): Row[] {
  const nl = text.indexOf('\n');
  const header = text.slice(0, nl).replace(/^﻿/, '').replace(/\r$/, '');
  const keep: string[] = [header];
  let pos = nl + 1;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const comma = text.indexOf(',', pos);
    let key = text.slice(pos, comma > -1 && comma < end ? comma : end);
    if (key.startsWith('"')) key = key.slice(1, -1);
    if (keys.has(key)) keep.push(text.slice(pos, end).replace(/\r$/, ''));
    pos = end + 1;
  }
  return csv(keep.join('\n'));
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const wc = (s: string | undefined): Wheelchair => (s === '1' ? 1 : s === '2' ? 2 : 0);
const secs = (t: string): number => {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
const sortRoutes = (rs: Iterable<RouteId>): RouteId[] =>
  [...new Set(rs)].sort((a, b) => SUBWAY_ROUTES.indexOf(a) - SUBWAY_ROUTES.indexOf(b));

async function main() {
  const zipBuf = await getZip();
  const want = [
    'stops.txt',
    'routes.txt',
    'route_patterns.txt',
    'trips.txt',
    'stop_times.txt',
    'pathways.txt',
    'facilities.txt',
    'facilities_properties.txt',
    'shapes.txt',
  ];
  const files = unzipSync(zipBuf, { filter: (f) => want.includes(f.name) });
  const text = (name: string) => {
    const f = files[name];
    if (!f) throw new Error(`${name} missing from GTFS zip`);
    return strFromU8(f);
  };

  // ---------- stops ----------
  const stops = new Map<string, Row>();
  for (const s of csv(text('stops.txt'))) stops.set(s.stop_id, s);
  /** Parent station of any stop (boarding areas -> platform -> station). */
  const stationOf = (id: string): string | null => {
    let cur = stops.get(id);
    for (let i = 0; cur && i < 4; i++) {
      if (cur.location_type === '1') return cur.stop_id;
      if (!cur.parent_station) return null;
      cur = stops.get(cur.parent_station);
    }
    return null;
  };

  // ---------- routes and patterns ----------
  const routes = new Map<string, Row>();
  for (const r of csv(text('routes.txt'))) if (SUBWAY.has(r.route_id)) routes.set(r.route_id, r);
  const allPatterns = csv(text('route_patterns.txt')).filter((p) => SUBWAY.has(p.route_id));
  const hasCanonical = allPatterns.length > 0 && 'canonical_route_pattern' in allPatterns[0];
  const canonical = allPatterns.filter((p) =>
    hasCanonical ? p.canonical_route_pattern === '1' : p.route_pattern_typicality === '1',
  );
  // Typical patterns add platforms (not rides) so live predictions on alternate platforms still map.
  const typical = allPatterns.filter((p) => p.route_pattern_typicality === '1');
  const repTrips = new Set([...canonical, ...typical].map((p) => p.representative_trip_id));

  // The "canonical-*" representative trips carry placeholder times (exactly 1 minute per stop),
  // so ride times come from a sample of real scheduled trips on the same canonical patterns.
  const SAMPLE_PER_PATTERN = 30;
  const canonicalIds = new Set(canonical.map((p) => p.route_pattern_id));
  const sampleCount = new Map<string, number>();
  const sampleTrips = new Set<string>();

  const tripShape = new Map<string, string>();
  for (const t of csvFiltered(text('trips.txt'), new Set(SUBWAY))) {
    if (repTrips.has(t.trip_id)) tripShape.set(t.trip_id, t.shape_id);
    if (canonicalIds.has(t.route_pattern_id) && !t.trip_id.startsWith('canonical-')) {
      const n = sampleCount.get(t.route_pattern_id) ?? 0;
      if (n < SAMPLE_PER_PATTERN) {
        sampleCount.set(t.route_pattern_id, n + 1);
        sampleTrips.add(t.trip_id);
      }
    }
  }

  // stop_times is ~130 MB: scan lines and parse only the representative and sampled trips.
  const tripStops = new Map<string, { stop: string; seq: number; t: number | null }[]>();
  // stop_times has trip_id first, so filter on it directly.
  for (const st of csvFiltered(text('stop_times.txt'), new Set([...repTrips, ...sampleTrips]))) {
    const time = st.departure_time || st.arrival_time;
    const list = tripStops.get(st.trip_id) ?? [];
    list.push({ stop: st.stop_id, seq: Number(st.stop_sequence), t: time ? secs(time) : null });
    tripStops.set(st.trip_id, list);
  }
  for (const list of tripStops.values()) list.sort((a, b) => a.seq - b.seq);

  // Median scheduled minutes between consecutive platforms, from the real sampled trips.
  const pairSamples = new Map<string, number[]>();
  for (const id of sampleTrips) {
    const list = tripStops.get(id) ?? [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a.t === null || b.t === null) continue;
      const min = (b.t - a.t) / 60;
      if (min <= 0 || min > 30) continue;
      // Keyed by platform pair and by station pair: some real trips stop at different platforms.
      for (const key of [`${a.stop}>${b.stop}`, `${stationOf(a.stop)}>${stationOf(b.stop)}`]) {
        const arr = pairSamples.get(key) ?? [];
        arr.push(min);
        pairSamples.set(key, arr);
      }
    }
  }
  const medianMinutes = (key: string): number | null => {
    const arr = pairSamples.get(key);
    if (!arr?.length) return null;
    const s = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  // ---------- platforms and rides ----------
  const platforms: Record<string, Platform> = {};
  const stationRoutes = new Map<string, Set<RouteId>>();
  const addPlatform = (stopId: string, route: RouteId) => {
    const s = stops.get(stopId);
    const stationId = stationOf(stopId);
    if (!s || !stationId) {
      console.warn(`  skip stop ${stopId}: no parent station`);
      return false;
    }
    const p = (platforms[stopId] ??= {
      id: stopId,
      stationId,
      name: s.platform_name || s.stop_name,
      routes: [],
    });
    if (!p.routes.includes(route)) p.routes = sortRoutes([...p.routes, route]);
    if (!stationRoutes.has(stationId)) stationRoutes.set(stationId, new Set());
    stationRoutes.get(stationId)!.add(route);
    return true;
  };

  const rides: RideEdge[] = [];
  const rideKeys = new Set<string>();
  for (const p of canonical) {
    const list = tripStops.get(p.representative_trip_id);
    if (!list?.length) {
      console.warn(`  canonical pattern ${p.route_pattern_id}: no stop_times for ${p.representative_trip_id}`);
      continue;
    }
    const route = p.route_id as RouteId;
    const dir = (p.direction_id === '1' ? 1 : 0) as 0 | 1;
    for (const st of list) addPlatform(st.stop, route);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (!platforms[a.stop] || !platforms[b.stop] || a.stop === b.stop) continue;
      const key = `${a.stop}>${b.stop}>${route}`;
      if (rideKeys.has(key)) continue;
      rideKeys.add(key);
      // Real-trip median first; the representative trip's own times are placeholders, so fall back to 2 min.
      const raw =
        medianMinutes(`${a.stop}>${b.stop}`) ?? medianMinutes(`${stationOf(a.stop)}>${stationOf(b.stop)}`) ?? 2;
      rides.push({ from: a.stop, to: b.stop, route, directionId: dir, minutes: Math.max(0.5, Math.round(raw * 10) / 10) });
    }
  }
  for (const p of typical) {
    for (const st of tripStops.get(p.representative_trip_id) ?? []) {
      // only platforms of stations already on a canonical pattern (avoids shuttle/oddball stops)
      const sid = stationOf(st.stop);
      if (sid && stationRoutes.has(sid)) addPlatform(st.stop, p.route_id as RouteId);
    }
  }
  // Remaining subway platforms (terminal tracks like Alewife-01, loop/drop-off platforms) that live
  // predictions can use but no typical pattern lists. They get the station's routes of the same route_type.
  for (const s of stops.values()) {
    if (s.location_type !== '0' || platforms[s.stop_id] || (s.vehicle_type !== '0' && s.vehicle_type !== '1')) continue;
    const sid = stationOf(s.stop_id);
    if (!sid || !stationRoutes.has(sid)) continue;
    for (const r of stationRoutes.get(sid)!) if (routes.get(r)?.route_type === s.vehicle_type) addPlatform(s.stop_id, r);
  }
  const network: Network = { platforms, rides };
  const subwayStations = new Set(stationRoutes.keys());

  // ---------- facilities ----------
  const props = new Map<string, Row[]>();
  for (const pr of csv(text('facilities_properties.txt'))) {
    const list = props.get(pr.facility_id) ?? [];
    list.push(pr);
    props.set(pr.facility_id, list);
  }
  const prop = (id: string, key: string) => props.get(id)?.find((p) => p.property_id === key)?.value;
  const facRows = csv(text('facilities.txt'));
  const facilities: Facility[] = [];
  const parking: ParkingLot[] = [];
  for (const f of facRows) {
    const stationId = stationOf(f.stop_id) ?? f.stop_id;
    if (!subwayStations.has(stationId)) continue;
    const type = FACILITY_TYPES[f.facility_type];
    if (type) {
      const fac: Facility = { id: f.facility_id, type, stationId, name: f.facility_long_name || f.facility_short_name };
      if (f.facility_short_name) fac.shortName = f.facility_short_name;
      const alt = prop(f.facility_id, 'alternate-service-text');
      if (alt) fac.alternateServiceText = alt;
      const ex = (props.get(f.facility_id) ?? []).filter((p) => p.property_id === 'excludes-stop').map((p) => p.value);
      if (ex.length) fac.excludesStops = ex;
      facilities.push(fac);
    } else if (f.facility_type === 'parking-area') {
      const lot: ParkingLot = {
        id: f.facility_id,
        stationId,
        name: f.facility_long_name || f.facility_short_name,
        capacity: num(prop(f.facility_id, 'capacity')),
        accessibleSpaces: num(prop(f.facility_id, 'capacity-accessible')),
      };
      const fee = prop(f.facility_id, 'fee-daily');
      if (fee) lot.feeDaily = fee;
      const app = prop(f.facility_id, 'payment-app');
      if (app) lot.paymentApp = app;
      const ov = prop(f.facility_id, 'overnight-allowed');
      if (ov) lot.overnightAllowed = ov;
      const lat = num(f.facility_lat);
      const lon = num(f.facility_lon);
      if (lat !== null && lon !== null) {
        lot.lat = r5(lat);
        lot.lon = r5(lon);
      }
      parking.push(lot);
    }
  }

  // ---------- stations ----------
  const children = new Map<string, Row[]>();
  for (const s of stops.values()) {
    if (!s.parent_station || s.location_type === '1') continue;
    const sid = stationOf(s.stop_id);
    if (!sid || !subwayStations.has(sid)) continue;
    const list = children.get(sid) ?? [];
    list.push(s);
    children.set(sid, list);
  }
  const stations: Station[] = [...subwayStations].sort().map((sid) => {
    const s = stops.get(sid)!;
    const kids = children.get(sid) ?? [];
    return {
      id: sid,
      name: s.stop_name,
      lat: r5(Number(s.stop_lat)),
      lon: r5(Number(s.stop_lon)),
      wheelchair: wc(s.wheelchair_boarding),
      routes: sortRoutes(stationRoutes.get(sid)!),
      platformIds: Object.values(platforms).filter((p) => p.stationId === sid).map((p) => p.id).sort(),
      entranceIds: kids.filter((k) => k.location_type === '2').map((k) => k.stop_id).sort(),
      facilityIds: facilities.filter((f) => f.stationId === sid).map((f) => f.id),
    };
  });

  // ---------- pathways ----------
  const kindOf = (s: Row): NodeKind =>
    s.location_type === '0' || s.location_type === '' ? 'platform'
      : s.location_type === '2' ? 'entrance'
        : s.location_type === '1' ? 'station'
          : 'node';
  const pathways: Record<string, StationPathways> = {};
  const nodeFor = (sp: StationPathways, id: string) => {
    if (sp.nodes[id]) return;
    const s = stops.get(id);
    if (!s) return;
    const name = s.location_type === '0' ? s.platform_name || s.stop_name : s.stop_name;
    sp.nodes[id] = { kind: kindOf(s), wheelchair: wc(s.wheelchair_boarding), ...(name ? { name } : {}) };
  };
  for (const sid of subwayStations) {
    const sp: StationPathways = { nodes: {}, edges: [] };
    for (const k of children.get(sid) ?? []) nodeFor(sp, k.stop_id);
    pathways[sid] = sp;
  }
  let pathwayRows = 0;
  for (const pw of csv(text('pathways.txt'))) {
    const a = stationOf(pw.from_stop_id);
    const b = stationOf(pw.to_stop_id);
    const sid = a && subwayStations.has(a) ? a : b && subwayStations.has(b) ? b : null;
    if (!sid) continue;
    pathwayRows++;
    const sp = pathways[sid];
    nodeFor(sp, pw.from_stop_id);
    nodeFor(sp, pw.to_stop_id);
    const len = num(pw.wheelchair_length) ?? num(pw.length);
    const seconds =
      num(pw.wheelchair_traversal_time) ?? num(pw.traversal_time) ?? (len !== null ? Math.max(5, Math.round(len)) : 30);
    const base = { mode: Number(pw.pathway_mode) as PathwayMode, facilityId: pw.facility_id || null, seconds };
    const edges: PathwayEdge[] = [{ from: pw.from_stop_id, to: pw.to_stop_id, ...base }];
    if (pw.is_bidirectional === '1') edges.push({ from: pw.to_stop_id, to: pw.from_stop_id, ...base });
    sp.edges.push(...edges);
  }

  // Surface stops (Green Line branches, some Mattapan) have no GTFS pathways. Give each a synthetic
  // street entrance "street-<stationId>" joined to every platform by a walkway, so routers can treat
  // all stations alike. Its wheelchair flag is the station's own flag. Not listed in Station.entranceIds.
  let synthetic = 0;
  for (const sid of subwayStations) {
    const sp = pathways[sid];
    if (sp.edges.length) continue;
    const st = stops.get(sid)!;
    const entrance = `street-${sid}`;
    sp.nodes[entrance] = { kind: 'entrance', wheelchair: wc(st.wheelchair_boarding), name: `${st.stop_name} (street level)` };
    for (const pid of Object.keys(sp.nodes).filter((n) => platforms[n])) {
      sp.edges.push({ from: entrance, to: pid, mode: 1, facilityId: null, seconds: 30 });
      sp.edges.push({ from: pid, to: entrance, mode: 1, facilityId: null, seconds: 30 });
    }
    synthetic++;
  }

  // ---------- line shapes ----------
  const shapeIds = new Set<string>();
  const shapeMeta: { shapeId: string; route: RouteId; pattern: string }[] = [];
  for (const p of canonical) {
    if (p.direction_id !== '0') continue; // one geometry per branch is enough to draw the line
    const shapeId = tripShape.get(p.representative_trip_id);
    if (!shapeId) {
      console.warn(`  no shape for ${p.route_pattern_id}`);
      continue;
    }
    shapeIds.add(shapeId);
    shapeMeta.push({ shapeId, route: p.route_id as RouteId, pattern: p.route_pattern_id });
  }
  const pts = new Map<string, { seq: number; c: [number, number] }[]>();
  for (const s of csvFiltered(text('shapes.txt'), shapeIds)) {
    const list = pts.get(s.shape_id) ?? [];
    list.push({ seq: Number(s.shape_pt_sequence), c: [r5(Number(s.shape_pt_lon)), r5(Number(s.shape_pt_lat))] });
    pts.set(s.shape_id, list);
  }
  const features = shapeMeta
    .filter((m) => pts.get(m.shapeId)?.length)
    .map((m) => {
      const coords = pts.get(m.shapeId)!.sort((a, b) => a.seq - b.seq).map((p) => p.c);
      const dedup = coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
      return {
        type: 'Feature' as const,
        properties: { route: m.route, color: '#' + (routes.get(m.route)?.route_color ?? '888888'), pattern: m.pattern },
        geometry: { type: 'LineString' as const, coordinates: dedup },
      };
    });
  const lines = { type: 'FeatureCollection', features };

  // ---------- write ----------
  mkdirSync(OUT_DIR, { recursive: true });
  const write = (name: string, data: unknown) => {
    const s = JSON.stringify(data);
    writeFileSync(path.join(OUT_DIR, name), s);
    return `${name} ${(s.length / 1024).toFixed(0)}KB`;
  };
  const elevators = facilities.filter((f) => f.type === 'ELEVATOR').length;
  const acc = stations.filter((s) => s.wheelchair === 1).length;
  const edgeCount = Object.values(pathways).reduce((n, p) => n + p.edges.length, 0);
  const sizes = [
    write('stations.json', stations),
    write('network.json', network),
    write('pathways.json', pathways),
    write('facilities.json', facilities),
    write('parking.json', parking),
    write('lines.geojson', lines),
  ];
  console.log(
    `stations=${stations.length} (accessible ${acc}, not ${stations.filter((s) => s.wheelchair === 2).length}) | ` +
      `platforms=${Object.keys(platforms).length} rides=${rides.length} | ` +
      `pathways stations=${Object.keys(pathways).length} rows=${pathwayRows} edges=${edgeCount} street-level=${synthetic} | ` +
      `facilities=${facilities.length} (elevators ${elevators}) | parking=${parking.length} | lines=${features.length}`,
  );
  console.log(sizes.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
