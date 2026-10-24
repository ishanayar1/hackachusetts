// Invariants for the generated static data (run `npx tsx scripts/build-gtfs.ts` first).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SUBWAY_ROUTES,
  type Facility,
  type Network,
  type ParkingLot,
  type Station,
  type StationPathways,
} from '@/lib/mbta/types';

const DIR = path.resolve(__dirname, '..', 'public', 'data');
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as T;

const built = existsSync(path.join(DIR, 'network.json'));

describe.skipIf(!built)('static GTFS data', () => {
  const stations = load<Station[]>('stations.json');
  const network = load<Network>('network.json');
  const pathways = load<Record<string, StationPathways>>('pathways.json');
  const facilities = load<Facility[]>('facilities.json');
  const parking = load<ParkingLot[]>('parking.json');
  const lines = load<{ features: { properties: { route: string; color: string }; geometry: { type: string; coordinates: number[][] } }[] }>(
    'lines.geojson',
  );
  const stationIds = new Set(stations.map((s) => s.id));
  const facilityIds = new Set(facilities.map((f) => f.id));

  it('has the known subway station counts', () => {
    expect(stations.length).toBeGreaterThanOrEqual(120);
    expect(stations.length).toBeLessThanOrEqual(130);
    expect(stations.filter((s) => s.wheelchair === 1).length).toBeGreaterThanOrEqual(95);
    const elevators = facilities.filter((f) => f.type === 'ELEVATOR').length;
    expect(elevators).toBeGreaterThanOrEqual(180);
    expect(elevators).toBeLessThanOrEqual(195);
  });

  it('includes Park Street and Downtown Crossing with elevators and pathways', () => {
    for (const id of ['place-pktrm', 'place-dwnxg']) {
      const st = stations.find((s) => s.id === id);
      expect(st, id).toBeDefined();
      expect(facilities.some((f) => f.stationId === id && f.type === 'ELEVATOR'), id).toBe(true);
      expect(pathways[id]?.edges.length ?? 0, id).toBeGreaterThan(10);
      expect(st!.entranceIds.length, id).toBeGreaterThan(0);
    }
  });

  it('every RideEdge endpoint is a known platform', () => {
    expect(network.rides.length).toBeGreaterThan(200);
    for (const r of network.rides) {
      expect(network.platforms[r.from], r.from).toBeDefined();
      expect(network.platforms[r.to], r.to).toBeDefined();
      expect(r.minutes).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("every platform's stationId is a known station", () => {
    for (const p of Object.values(network.platforms)) expect(stationIds.has(p.stationId), p.id).toBe(true);
    for (const s of stations) for (const pid of s.platformIds) expect(network.platforms[pid]?.stationId, pid).toBe(s.id);
  });

  it('every elevator pathway facilityId is in facilities.json', () => {
    const orphans = new Set<string>();
    for (const sp of Object.values(pathways))
      for (const e of sp.edges) if (e.mode === 5 && e.facilityId && !facilityIds.has(e.facilityId)) orphans.add(e.facilityId);
    // Known GTFS orphans: none at the time of writing.
    const KNOWN: string[] = [];
    expect([...orphans].filter((o) => !KNOWN.includes(o))).toEqual([]);
  });

  it('every pathway edge endpoint is a node of its station', () => {
    for (const [sid, sp] of Object.entries(pathways))
      for (const e of sp.edges) {
        expect(sp.nodes[e.from], `${sid} ${e.from}`).toBeDefined();
        expect(sp.nodes[e.to], `${sid} ${e.to}`).toBeDefined();
      }
  });

  it('every accessible station has a step-free entrance-to-platform path', () => {
    const failures: string[] = [];
    for (const st of stations.filter((s) => s.wheelchair === 1)) {
      const sp = pathways[st.id];
      const adj = new Map<string, string[]>();
      for (const e of sp.edges) {
        if (e.mode === 2 || e.mode === 4) continue;
        (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
      }
      const starts = Object.keys(sp.nodes).filter((n) => sp.nodes[n].kind === 'entrance');
      const seen = new Set(starts);
      const queue = [...starts];
      let ok = false;
      while (queue.length && !ok) {
        const n = queue.shift()!;
        if (sp.nodes[n]?.kind === 'platform' && network.platforms[n]) ok = true;
        for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), queue.push(m));
      }
      if (!ok) failures.push(st.id);
    }
    expect(failures).toEqual([]);
  });

  it('surface stops without GTFS pathways get a synthetic street entrance', () => {
    for (const st of stations) {
      const sp = pathways[st.id];
      const street = sp.nodes[`street-${st.id}`];
      if (!street) continue;
      expect(street.kind).toBe('entrance');
      expect(street.wheelchair).toBe(st.wheelchair);
      expect(sp.edges.every((e) => e.mode === 1 && e.facilityId === null)).toBe(true);
    }
  });

  it('the ride graph is connected per route (station level)', () => {
    for (const route of SUBWAY_ROUTES) {
      const rides = network.rides.filter((r) => r.route === route);
      expect(rides.length, route).toBeGreaterThan(0);
      const st = (pid: string) => network.platforms[pid].stationId;
      const adj = new Map<string, Set<string>>();
      const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      for (const r of rides) (link(st(r.from), st(r.to)), link(st(r.to), st(r.from)));
      const nodes = [...adj.keys()];
      const seen = new Set([nodes[0]]);
      const queue = [nodes[0]];
      while (queue.length) for (const m of adj.get(queue.shift()!)!) if (!seen.has(m)) (seen.add(m), queue.push(m));
      expect(seen.size, route).toBe(nodes.length);
      // every station that lists this route is on its ride graph
      for (const s of stations.filter((x) => x.routes.includes(route))) expect(adj.has(s.id), `${route} ${s.id}`).toBe(true);
    }
  });

  it('every entrance node carries coordinates near its station', () => {
    const byId = new Map(stations.map((s) => [s.id, s]));
    for (const [sid, sp] of Object.entries(pathways)) {
      const st = byId.get(sid)!;
      for (const [id, n] of Object.entries(sp.nodes)) {
        if (n.kind !== 'entrance') continue;
        expect(typeof n.lat, `${sid} ${id}`).toBe('number');
        expect(typeof n.lon, `${sid} ${id}`).toBe('number');
        expect(Math.abs(n.lat! - st.lat) + Math.abs(n.lon! - st.lon), `${sid} ${id}`).toBeLessThan(0.01);
      }
    }
    expect(pathways['place-jfk'].nodes['door-jfk-columbia']).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
  });

  it('mini-high platforms and mobile lifts map to the platforms they serve', () => {
    const boarding = facilities.filter((f) => f.type === 'ELEVATED_SUBPLATFORM' || f.type === 'PORTABLE_BOARDING_LIFT');
    expect(boarding.filter((f) => f.type === 'ELEVATED_SUBPLATFORM').length).toBeGreaterThanOrEqual(20);
    for (const f of boarding) {
      expect(f.platformIds?.length, f.id).toBeGreaterThan(0);
      for (const p of f.platformIds!) {
        expect(network.platforms[p]?.stationId, `${f.id} ${p}`).toBe(f.stationId);
        expect(f.excludesStops ?? [], `${f.id} ${p}`).not.toContain(p);
      }
      expect(stations.find((s) => s.id === f.stationId)!.facilityIds).toContain(f.id);
    }
    expect(facilities.find((f) => f.id === 'subplat-cenav-1')?.platformIds).toEqual(['70270']);
    expect(facilities.find((f) => f.id === 'subplat-cenav-0')?.platformIds).toEqual(['70269']);
    expect(facilityIds.has('subplat-bbsta-5')).toBe(false); // Commuter Rail only
  });

  it('ride times are weekday medians: Andrew -> JFK/UMass is 3 min on both branch platforms', () => {
    const andrewJfk = network.rides.filter((r) => r.from === '70083' && (r.to === '70085' || r.to === '70095'));
    expect(andrewJfk.map((r) => r.minutes)).toEqual([3, 3]);
    const dtxPark = network.rides.find((r) => r.from === '70078' && r.to === '70076');
    expect(dtxPark?.minutes).toBe(2);
  });

  it('headways are real weekday daytime medians for every route and direction', () => {
    const hw = (network as Network & { headways?: Record<string, { 0: number; 1: number }> }).headways;
    expect(hw).toBeDefined();
    for (const r of SUBWAY_ROUTES) {
      for (const d of [0, 1] as const) {
        const h = hw![r]?.[d];
        expect(typeof h, `${r}/${d}`).toBe('number');
        expect(h, `${r}/${d}`).toBeGreaterThanOrEqual(2);
        expect(h, `${r}/${d}`).toBeLessThanOrEqual(20);
      }
    }
    // Fall 2026 feed (weekday 07:00-19:00): Red/Orange/Blue 5 min, Green branches 8, Mattapan 7.
    expect(hw!.Red[0]).toBeLessThanOrEqual(7);
    for (const g of ['Green-B', 'Green-C', 'Green-D', 'Green-E']) expect(hw![g][0], g).toBeGreaterThanOrEqual(5);
    expect(hw!.Mattapan[0]).toBeGreaterThanOrEqual(5);
  });

  it('parking lots and line shapes are well formed', () => {
    expect(parking.length).toBeGreaterThan(0);
    for (const p of parking) expect(stationIds.has(p.stationId), p.id).toBe(true);
    const routes = new Set(lines.features.map((f) => f.properties.route));
    for (const r of SUBWAY_ROUTES) expect(routes.has(r), r).toBe(true);
    for (const f of lines.features) {
      expect(f.geometry.type).toBe('LineString');
      expect(f.geometry.coordinates.length).toBeGreaterThan(10);
      expect(f.properties.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
